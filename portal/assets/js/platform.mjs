// Platform state for the portal: guest-first (localStorage) with the server as the source of truth once
// signed in (ADR 0009). Every method resolves (never throws) so a dead API never breaks a page.
import { SITE } from '/shared/site.mjs';
import { GAMES, gameBySlug } from '/shared/games.mjs';
import { featuredGame } from '/shared/seeds.mjs';
import { addPending, guestCheckin, guestGrant, guestRecordRun, rollGuestDay, sanitizeGuest } from '/shared/economy.mjs';
import { dailyQuests, questProgress, questText } from '/shared/quests.mjs';
import { utcDay } from '/shared/util.mjs';
import { api } from './api.mjs';

const GUEST_KEY = `${SITE.storagePrefix}guest`;
const TITLES = Object.fromEntries(GAMES.map((g) => [g.slug, g.title]));

function safeStorage() {
  try {
    const s = globalThis.localStorage;
    s.setItem(`${SITE.storagePrefix}probe`, '1');
    s.removeItem(`${SITE.storagePrefix}probe`);
    return s;
  } catch {
    return null; // private mode / blocked storage: the guest just isn't persisted
  }
}

function newGuestId() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return `g_${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}`;
}

export class Platform {
  constructor() {
    this.storage = safeStorage();
    this.config = null;
    this.me = null;
    this.online = null; // unknown until boot() has asked the API
    this.listeners = new Set();
    this.guest = this.loadGuest();
    globalThis.addEventListener('storage', (e) => {
      if (e.key === GUEST_KEY) {
        this.guest = this.loadGuest();
        this.emit();
      }
    });
  }

  /* ------------------------------ state ------------------------------ */
  today() { return this.config?.day || utcDay(); }
  get signedIn() { return Boolean(this.me?.player); }
  get vip() { return Boolean(this.me?.player?.vip); }
  get leaderboards() { return Boolean(this.config?.leaderboards); }
  get featuredSlug() { return this.config?.featured || featuredGame(this.today(), GAMES)?.slug || null; }
  get username() { return this.me?.player?.username || null; }

  wallet() {
    if (this.signedIn) return { credits: this.me.wallet.credits, gems: this.me.wallet.gems, vip: this.vip, signedIn: true };
    return { credits: this.guest.credits, gems: 0, vip: false, signedIn: false };
  }

  trail() { return this.signedIn ? this.me.trail || null : null; }

  streak() { return this.signedIn ? this.me.player.streak : this.guest.streak; }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) {
      try { fn(this); } catch (err) { console.error(err); }
    }
  }

  loadGuest() {
    let raw = null;
    try { raw = JSON.parse(this.storage?.getItem(GUEST_KEY) || 'null'); } catch { raw = null; }
    return rollGuestDay(sanitizeGuest(raw, newGuestId()), utcDay());
  }

  saveGuest() {
    try { this.storage?.setItem(GUEST_KEY, JSON.stringify(this.guest)); } catch { /* full or blocked */ }
  }

  setGuest(next) {
    this.guest = next;
    this.saveGuest();
    this.emit();
  }

  /* ------------------------------ boot ------------------------------- */
  async boot() {
    const [cfg, me] = await Promise.all([api('/api/config'), api('/api/me')]);
    this.config = cfg.ok ? cfg.data : null;
    this.online = me.ok;
    this.me = me.ok && me.data?.player ? me.data : null;
    this.guest = rollGuestDay(this.guest, this.today());
    this.emit();
    const checkin = await this.dailyCheckin();
    if (this.signedIn) await this.flushPending();
    return { checkin };
  }

  async refreshMe() {
    const r = await api('/api/me');
    if (r.ok) this.me = r.data?.player ? r.data : null;
    this.emit();
    return r.ok;
  }

  async dailyCheckin() {
    if (this.signedIn) {
      if (this.me.checkedInToday) return null;
      const r = await api('/api/me/checkin', { method: 'POST' });
      if (!r.ok) return null;
      await this.refreshMe();
      return r.data.reward > 0 ? { reward: r.data.reward, streak: r.data.streak } : null;
    }
    const res = guestCheckin(rollGuestDay(this.guest, this.today()), this.today());
    if (res.reward > 0) this.setGuest(res.guest);
    return res.reward > 0 ? { reward: res.reward, streak: res.streak } : null;
  }

  /* ---------------------------- accounts ----------------------------- */
  async register(username) {
    const r = await api('/api/auth/register', { method: 'POST', body: { username } });
    if (!r.ok) return { ok: false, error: r.error };
    const merged = await this.afterSignIn();
    return { ok: true, key: r.data.key, merged };
  }

  async login(username, key) {
    const r = await api('/api/auth/login', { method: 'POST', body: { username, key } });
    if (!r.ok) return { ok: false, error: r.error };
    const merged = await this.afterSignIn();
    return { ok: true, merged };
  }

  /** Folds guest credits into the account (server caps them) and claims runs played as a guest. */
  async afterSignIn() {
    await this.refreshMe();
    let merged = 0;
    if (this.guest.credits > 0) {
      const m = await api('/api/me/merge', { method: 'POST', body: { guest: { id: this.guest.id, credits: this.guest.credits } } });
      if (m.ok) {
        merged = m.data.merged;
        this.setGuest({ ...this.guest, credits: 0 });
      }
    }
    await this.dailyCheckin();
    const claimed = await this.flushPending();
    await this.refreshMe();
    return { credits: merged, runs: claimed };
  }

  async logout() {
    await api('/api/auth/logout', { method: 'POST' });
    this.me = null;
    this.emit();
  }

  async deleteAccount(confirm) {
    const r = await api('/api/me', { method: 'DELETE', body: { confirm } });
    if (r.ok) {
      this.me = null;
      this.emit();
    }
    return r;
  }

  /* ------------------------------ runs ------------------------------- */
  /** → token string, or null when leaderboards/network are unavailable (the run still plays). */
  async startRun(slug, seed) {
    if (!this.leaderboards) return null;
    const r = await api('/api/runs', { method: 'POST', body: { game: slug, seed } });
    return r.ok ? r.data.token : null;
  }

  /**
   * Signed in: submit to the server (queue on network failure). Guest: earn local credits and keep the run
   * as a pending claim. → {accepted, reason, rank, credits, ghostId, signedIn, isDaily}
   */
  async submitRun(slug, run) {
    const game = gameBySlug(slug);
    if (!game) return { accepted: false, reason: 'unknown-game', credits: 0, signedIn: this.signedIn };
    const featured = slug === this.featuredSlug;
    if (this.signedIn && run.token) {
      const r = await api('/api/scores', {
        method: 'POST',
        body: { token: run.token, score: run.score, survivalMs: run.survivalMs, meta: run.meta, ghost: run.ghost },
        timeoutMs: 12000,
      });
      if (r.ok) {
        await this.refreshMe();
        return {
          accepted: true, reason: 'accepted', rank: r.data.daily?.rank ?? null, best: r.data.daily?.best ?? null,
          credits: r.data.credits, ghostId: r.data.ghostId, isDaily: r.data.isDaily, signedIn: true,
        };
      }
      if (r.status === 0 || r.status >= 500) {
        this.setGuest(addPending(this.guest, { ...pendingFrom(slug, run), at: Date.now() }));
        return { accepted: false, reason: 'queued', credits: 0, signedIn: true };
      }
      return { accepted: false, reason: r.error, credits: 0, signedIn: true };
    }
    // Signed in but no token (leaderboards offline): nothing to claim later, and guest credits would be wrong.
    if (this.signedIn) return { accepted: false, reason: 'offline', credits: 0, signedIn: true };
    const local = guestRecordRun(this.guest, game, run, featured, this.today());
    let next = local.guest;
    if (run.token) next = addPending(next, { ...pendingFrom(slug, run), at: Date.now() });
    this.setGuest(next);
    return {
      accepted: false, reason: run.token ? 'sign-in-to-claim' : 'offline', credits: local.earned, signedIn: false,
    };
  }

  /** Submits runs queued as a guest or while offline. Tokens expire after 24 h (server rule). */
  async flushPending() {
    if (!this.signedIn || !this.guest.pending.length) return 0;
    let claimed = 0;
    const keep = [];
    for (const p of this.guest.pending) {
      const r = await api('/api/scores', { method: 'POST', body: { token: p.token, score: p.score, survivalMs: p.survivalMs, meta: p.meta, ghost: p.ghost } });
      if (r.ok) claimed++;
      else if (r.status === 0 || r.status >= 500) keep.push(p);
    }
    this.setGuest({ ...this.guest, pending: keep });
    return claimed;
  }

  /* ------------------------------ wallet ----------------------------- */
  async grant(reason, amount, slug) {
    if (this.signedIn) {
      const r = await api('/api/wallet/grant', { method: 'POST', body: { reason, amount, game: slug } });
      if (!r.ok) return { granted: 0, balance: this.wallet() };
      await this.refreshMe();
      return { granted: r.data.granted, balance: this.wallet() };
    }
    const res = guestGrant(this.guest, reason, amount, slug, this.today());
    this.setGuest(res.guest);
    return { granted: res.granted, balance: this.wallet() };
  }

  async spend(itemId, cost) {
    if (!this.signedIn) return { ok: false, reason: 'sign-in-required', balance: this.wallet() };
    const r = await api('/api/wallet/spend', { method: 'POST', body: cost === undefined ? { itemId } : { itemId, cost } });
    await this.refreshMe();
    return { ok: r.ok, reason: r.ok ? 'ok' : r.error, balance: this.wallet() };
  }

  async equip(itemId) {
    const r = await api('/api/me/equip', { method: 'POST', body: { itemId } });
    if (r.ok) await this.refreshMe();
    return r;
  }

  /* ------------------------------ quests ----------------------------- */
  quests() {
    if (this.signedIn && Array.isArray(this.me.quests)) {
      return this.me.quests.map((q) => ({ ...q, text: questText(q, TITLES) }));
    }
    const day = this.today();
    const g = rollGuestDay(this.guest, day);
    return dailyQuests(day, GAMES.map((x) => x.slug)).map((q) => ({
      ...q, ...questProgress(q, g.runs, this.featuredSlug), claimed: g.claimed.includes(q.id), text: questText(q, TITLES),
    }));
  }

  async claimQuest(id) {
    if (this.signedIn) {
      const r = await api(`/api/quests/${encodeURIComponent(id)}/claim`, { method: 'POST' });
      if (r.ok) await this.refreshMe();
      return r.ok ? { ok: true, granted: r.data.granted } : { ok: false, error: r.error };
    }
    const q = this.quests().find((x) => x.id === id);
    if (!q || !q.done || q.claimed) return { ok: false, error: q?.claimed ? 'quest-already-claimed' : 'quest-not-complete' };
    const g = rollGuestDay(this.guest, this.today());
    this.setGuest({ ...g, credits: g.credits + q.reward, claimed: [...g.claimed, q.id] });
    return { ok: true, granted: q.reward };
  }

  /* --------------------------- social / data -------------------------- */
  board(slug, kind) { return api(`/api/boards/${encodeURIComponent(slug)}?board=${encodeURIComponent(kind)}`); }
  trending() { return api('/api/trending'); }
  ghost(id) { return api(`/api/ghosts/${encodeURIComponent(id)}`); }
  friends() { return api('/api/friends'); }
  addFriend(code) { return api('/api/friends', { method: 'POST', body: { code } }); }
  removeFriend(code) { return api(`/api/friends/${encodeURIComponent(code)}`, { method: 'DELETE' }); }
  getSave(slug) { return api(`/api/saves/${encodeURIComponent(slug)}`); }
  putSave(slug, data) { return api(`/api/saves/${encodeURIComponent(slug)}`, { method: 'PUT', body: { data } }); }
}

function pendingFrom(slug, run) {
  return { token: run.token, game: slug, score: run.score, survivalMs: run.survivalMs, meta: run.meta || {}, ghost: run.ghost || null };
}
