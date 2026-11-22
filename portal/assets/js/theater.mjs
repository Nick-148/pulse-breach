// Game theater (/games/<slug>/): hosts the cartridge iframe, answers its ArcadeSDK calls, renders the
// leaderboard, challenge-link generator and banner slots outside the playfield (ADR 0007).
import { gameBySlug } from '/shared/games.mjs';
import { parseChallengeParams, challengeUrl, GHOST_ID_RE } from '/shared/seeds.mjs';
import { fmtInt, isObj } from '/shared/util.mjs';
import { startShell, openProfile } from './shell.mjs';
import { createHostBridge } from './bridge-host.mjs';
import { HostAds } from './ads.mjs';
import { errorMessage } from './api.mjs';
import { $, $$, h, replace, toast, copyText } from './dom.mjs';

const slug = document.body.dataset.game;
const game = gameBySlug(slug);
const challenge = parseChallengeParams(globalThis.location.search);
const frame = $('#game-frame');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let bridge = null;
let run = null;
let boardKind = 'daily';

const hooks = {
  onOpen: () => bridge?.emit('pause', { reason: 'dialog' }),
  onClose: () => frame.focus(),
};
const { platform, ready } = startShell(hooks);
const ads = new HostAds({ platform, onBusy: (busy) => document.body.classList.toggle('ad-playing', busy) });

/* ------------------------------ SDK handlers ------------------------------ */
function cleanMeta(meta) {
  if (!isObj(meta)) return {};
  const out = {};
  for (const [k, v] of Object.entries(meta).slice(0, 12)) {
    if (/^[a-zA-Z0-9_]{1,24}$/.test(k) && (typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)))) {
      out[k] = typeof v === 'string' ? v.slice(0, 64) : v;
    }
  }
  return out;
}

function cleanGhost(g) {
  if (!Array.isArray(g) || g.length > 6000 || g.length % 2) return null;
  const out = g.map((n) => Math.round(Number(n)));
  return out.every(Number.isFinite) ? out : null;
}

function resultMessage(res) {
  const credits = res.credits ? ` · +${fmtInt(res.credits)} credits` : '';
  if (res.accepted) return res.isDaily && res.rank ? `Ranked #${fmtInt(res.rank)} today${credits}` : `Run saved${credits}`;
  if (res.reason === 'sign-in-to-claim') return `Saved as guest${credits} · sign in to claim your spot`;
  if (res.reason === 'queued') return 'Saved. It will sync when you are back online';
  if (res.reason === 'offline') return `Saved on this device${credits}`;
  return `Score not ranked (${res.reason})`;
}

const handlers = {
  async init() {
    await Promise.race([ready, sleep(2500)]);
    return {
      game: slug,
      player: { signedIn: platform.signedIn, name: platform.username, vip: platform.vip },
      trail: platform.trail(),
      challenge,
      dailySeed: game.dailySeed(platform.today()),
      featured: platform.featuredSlug === slug,
      adFree: platform.vip,
      leaderboards: platform.leaderboards,
      offline: !platform.online,
    };
  },

  async runStarted(params) {
    const seed = typeof params?.seed === 'string' ? params.seed : '';
    if (!game.seedPattern.test(seed)) return { ok: false, daily: false };
    await ready;
    run = { seed, tokenPromise: platform.startRun(slug, seed) };
    const token = await run.tokenPromise;
    return { ok: Boolean(token), daily: seed === game.dailySeed(platform.today()) };
  },

  async submitScore(params) {
    const score = Math.floor(Number(params?.score));
    const survivalMs = Math.round(Number(params?.survivalTime) * 1000);
    const seed = typeof params?.seed === 'string' ? params.seed : '';
    if (!Number.isSafeInteger(score) || score < 0 || !Number.isSafeInteger(survivalMs) || survivalMs < 0) {
      return { accepted: false, reason: 'bad-score', rank: null, credits: 0, ghostId: null, signedIn: platform.signedIn };
    }
    const current = run && run.seed === seed ? run : null;
    run = null; // one submission per started run
    const token = current ? await current.tokenPromise : null;
    const res = await platform.submitRun(slug, {
      token, score, survivalMs, meta: cleanMeta(params.metadata), ghost: cleanGhost(params.ghostData),
    });
    toast(resultMessage(res), 4000);
    showChallengeCard({ seed, score, ghostId: res.ghostId || null, res });
    refreshBoard();
    return { accepted: res.accepted, reason: res.reason, rank: res.rank ?? null, credits: res.credits || 0, ghostId: res.ghostId || null, signedIn: res.signedIn };
  },

  'wallet.getBalance': async () => { await ready; return platform.wallet(); },
  'wallet.grant': async (p) => { await ready; return platform.grant(p?.reason, Number(p?.amount), slug); },
  'wallet.spend': async (p) => { await ready; return platform.spend(p?.itemId, p?.cost); },
  'ads.showRewarded': async (p) => { await ready; return ads.showRewarded(p?.placement); },

  async 'share.challenge'(p) {
    const url = challengeUrl(globalThis.location.origin, slug, { seed: p?.seed, beat: Number(p?.score), ghost: p?.ghost });
    const lines = [`${game.title.toUpperCase()} · ${p?.seed || ''}`];
    if (typeof p?.timeline === 'string') lines.push(p.timeline.slice(0, 80));
    if (Number.isFinite(Number(p?.score))) lines.push(`★ ${fmtInt(p.score)}`);
    lines.push(`Beat me: ${url}`);
    const text = lines.join('\n');
    const copied = await copyText(text);
    toast(copied ? 'Challenge copied!' : 'Copy failed: use the link in the sidebar');
    return { copied, url, text };
  },

  async 'save.get'() {
    await ready;
    if (!platform.signedIn) return { data: null };
    const r = await platform.getSave(slug);
    return { data: r.ok ? r.data.data : null };
  },
  async 'save.set'(p) {
    await ready;
    if (!platform.signedIn || !isObj(p?.data)) return { ok: false };
    const r = await platform.putSave(slug, p.data);
    return { ok: r.ok };
  },

  async 'ghost.get'(p) {
    if (typeof p?.id !== 'string' || !GHOST_ID_RE.test(p.id)) return null;
    const r = await platform.ghost(p.id);
    return r.ok && r.data.game === slug ? { seed: r.data.seed, frames: r.data.frames, hz: r.data.hz, name: r.data.name, score: r.data.score } : null;
  },

  gameplay(p) {
    document.body.classList.toggle('in-run', Boolean(p?.active));
    return null;
  },
};

/* ------------------------------ leaderboard ------------------------------- */
async function refreshBoard() {
  const list = $('#board-list');
  const status = $('#board-status');
  const meLine = $('#board-me');
  await ready;
  replace(meLine);
  if (!platform.leaderboards) {
    replace(list);
    status.textContent = 'Leaderboards are offline right now. Your runs still count on this device.';
    return;
  }
  if (boardKind === 'friends' && !platform.signedIn) {
    replace(list);
    replace(status, 'Sign in to compare with friends. ', h('button', { class: 'linkish', type: 'button', text: 'Sign in', onclick: () => openProfile(platform, hooks) }));
    return;
  }
  status.textContent = 'Loading…';
  const r = await platform.board(slug, boardKind);
  if (!r.ok) {
    replace(list);
    status.textContent = errorMessage(r.error);
    return;
  }
  const { entries, me, seed } = r.data;
  status.textContent = entries.length ? '' : boardKind === 'friends' ? 'No friend scores yet today.' : 'No scores yet. Set the first one!';
  replace(list, entries.map((e) => {
    const race = e.ghostId && seed
      ? h('a', { class: 'ghost-link', href: challengeUrl(globalThis.location.origin, slug, { seed, beat: e.score, ghost: e.ghostId }), title: `Race ${e.name}'s ghost`, 'aria-label': `Race ${e.name}'s ghost`, text: '👻' })
      : null;
    return h('li', { class: me && e.name === platform.username ? 'me' : '' },
      h('span', { class: 'rank', text: `#${e.rank}` }),
      h('span', { class: 'name', text: e.name }),
      race,
      h('span', { class: 'score', text: fmtInt(e.score) }));
  }));
  if (me) meLine.textContent = `You: #${fmtInt(me.rank)} · ${fmtInt(me.score)}`;
  else if (!platform.signedIn) replace(meLine, h('button', { class: 'linkish', type: 'button', text: 'Sign in to claim a spot', onclick: () => openProfile(platform, hooks) }));
}

function wireTabs() {
  for (const tab of $$('#board-tabs [role="tab"]')) {
    tab.addEventListener('click', () => {
      boardKind = tab.dataset.board;
      for (const t of $$('#board-tabs [role="tab"]')) t.setAttribute('aria-selected', String(t === tab));
      refreshBoard();
    });
  }
}

/* ---------------------------- challenge a friend --------------------------- */
function showChallengeCard({ seed, score, ghostId }) {
  const card = $('#challenge-card');
  if (!card || !seed) return;
  const url = challengeUrl(globalThis.location.origin, slug, { seed, beat: score, ghost: ghostId });
  const input = h('input', { class: 'link-field', readonly: true, value: url, 'aria-label': 'Challenge link' });
  input.addEventListener('focus', () => input.select());
  const copy = h('button', { class: 'btn primary small', type: 'button', text: 'Copy link', onclick: async () => toast((await copyText(url)) ? 'Link copied!' : 'Copy failed: select the link') });
  const share = typeof navigator.share === 'function'
    ? h('button', { class: 'btn small', type: 'button', text: 'Share', onclick: () => navigator.share({ title: game.title, text: `Beat my ${fmtInt(score)} in ${game.title}!`, url }).catch(() => {}) })
    : null;
  replace(card,
    h('h2', { class: 'h3', text: 'Challenge a friend' }),
    h('p', { class: 'muted small' }, `Same seed, target ${fmtInt(score)}`, ghostId ? ', and they race your ghost.' : '.'),
    input, h('div', { class: 'row' }, copy, share));
  card.hidden = false;
}

/* ---------------------------------- boot ---------------------------------- */
function boot() {
  if (!game || !frame) return;
  bridge = createHostBridge({ frame, origin: globalThis.location.origin, handlers });
  const params = new URLSearchParams();
  if (challenge.seed) params.set('seed', challenge.seed);
  if (challenge.beat) params.set('beat', String(challenge.beat));
  if (challenge.ghost) params.set('ghost', challenge.ghost);
  // e2e hooks inside the cartridge (they only read game state; nothing privileged).
  if (new URLSearchParams(globalThis.location.search).get('debug') === '1') params.set('debug', '1');
  const qs = params.toString();
  frame.src = `/games/${slug}/play/${qs ? `?${qs}` : ''}`;
  frame.addEventListener('load', () => frame.focus());

  const banner = $('#target-banner');
  if (banner && challenge.seed) {
    banner.textContent = challenge.beat
      ? `TARGET TO BEAT: ${fmtInt(challenge.beat)}${challenge.ghost ? ' · racing their ghost' : ''}`
      : `Challenge seed ${challenge.seed}`;
    banner.hidden = false;
  }
  $('#fullscreen-btn')?.addEventListener('click', () => {
    const req = frame.requestFullscreen || frame.webkitRequestFullscreen;
    if (req) Promise.resolve(req.call(frame)).catch(() => toast('Fullscreen is not available here'));
    frame.focus();
  });
  wireTabs();
  ready.then(() => {
    ads.renderBanners();
    refreshBoard();
    bridge.emit('trail', platform.trail());
  });
  // Signing in claims guest runs (several requests), so refresh the board once things settle.
  let signedIn = platform.signedIn;
  let boardTimer = 0;
  platform.subscribe(() => {
    ads.renderBanners();
    clearTimeout(boardTimer);
    boardTimer = setTimeout(refreshBoard, 400);
    if (platform.signedIn !== signedIn) {
      signedIn = platform.signedIn;
      bridge.emit('trail', platform.trail());
    }
  });
}

boot();
