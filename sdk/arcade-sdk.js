/*
 * ArcadeSDK v1: the bridge between a single-file game ("cartridge") and the arcade theater page (ADR 0007).
 *
 * - Injected by the build into the hosted copy of each game only. The standalone game never sees it.
 * - Defines window.ArcadeSDK ONLY when the page is framed by a same-origin parent (the theater). Opened
 *   directly, or framed cross-origin, it does nothing and the game runs standalone.
 * - Every method returns a Promise that RESOLVES (never rejects) with a documented fallback when the host
 *   doesn't answer in time, so a game can always `await` it without try/catch and keep playing.
 * - Transport: window.postMessage with exact targetOrigin, and both sides check event.origin + event.source.
 *   The host owns network, session, wallet and ads; a game never calls /api itself.
 */
(function () {
  'use strict';

  const NS = 'arcade-sdk';
  const VERSION = '1.0.0';
  const SEED_RE = /^[A-Z0-9-]{1,32}$/;
  const GHOST_RE = /^[a-f0-9]{32}$/;
  const SLUG_RE = /^[a-z0-9-]{1,40}$/;

  const self = window;
  const parentWin = self.parent;
  if (!parentWin || parentWin === self) return;
  let origin;
  try {
    origin = self.location.origin;
    if (parentWin.location.origin !== origin) return; // cross-origin parent: throws or differs
  } catch {
    return;
  }

  const pending = new Map();
  const listeners = new Map();
  let seq = 0;
  let slug = null;

  self.addEventListener('message', function (e) {
    if (e.source !== parentWin || e.origin !== origin) return;
    const m = e.data;
    if (!m || m.ns !== NS) return;
    if (m.kind === 'res') {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      clearTimeout(p.timer);
      p.resolve(m.ok ? m.result : p.fallback);
    } else if (m.kind === 'evt' && typeof m.name === 'string') {
      const fns = listeners.get(m.name) || [];
      for (let i = 0; i < fns.length; i++) {
        try { fns[i](m.data); } catch { /* a game listener must not break the bridge */ }
      }
    }
  });

  function call(method, params, fallback, timeoutMs) {
    return new Promise(function (resolve) {
      const id = ++seq;
      const timer = setTimeout(function () {
        pending.delete(id);
        resolve(fallback);
      }, timeoutMs || 8000);
      pending.set(id, { resolve: resolve, fallback: fallback, timer: timer });
      try {
        parentWin.postMessage({ ns: NS, kind: 'req', id: id, method: method, params: params === undefined ? null : params }, origin);
      } catch {
        clearTimeout(timer);
        pending.delete(id);
        resolve(fallback);
      }
    });
  }

  const OFFLINE_PLAYER = Object.freeze({ signedIn: false, name: null, vip: false });

  /** Synchronous so a game can build its share text inside the click handler (clipboard needs the gesture). */
  function challengeUrl(opts) {
    const o = opts || {};
    const url = new URL('/games/' + (slug || 'unknown') + '/', origin);
    const seed = typeof o.seed === 'string' ? o.seed.trim().toUpperCase() : '';
    if (SEED_RE.test(seed)) {
      url.searchParams.set('seed', seed);
      if (typeof o.score === 'number' && isFinite(o.score) && o.score > 0) url.searchParams.set('beat', String(Math.floor(o.score)));
      if (typeof o.ghost === 'string' && GHOST_RE.test(o.ghost)) url.searchParams.set('ghost', o.ghost);
    }
    return url.toString();
  }

  const sdk = {
    version: VERSION,
    /** True: the theater renders banner ads outside the frame, so the game must hide its own banner slot. */
    hostsBanner: true,

    /**
     * → {game, player:{signedIn,name,vip}, trail:{id,name,colors}|null, challenge:{seed,beat,ghost},
     *    dailySeed, featured, adFree, leaderboards, offline}
     */
    init: function (gameSlug) {
      if (typeof gameSlug === 'string' && SLUG_RE.test(gameSlug)) slug = gameSlug;
      return call('init', { game: slug }, {
        game: slug, player: OFFLINE_PLAYER, trail: null, challenge: { seed: null, beat: null, ghost: null },
        dailySeed: null, featured: false, adFree: false, leaderboards: false, offline: true,
      }, 4000);
    },

    /** Call when a run starts so the platform can issue a signed run token. → {ok, daily} */
    runStarted: function (info) {
      const i = info || {};
      return call('runStarted', { seed: i.seed, mode: i.mode }, { ok: false, daily: false });
    },

    /**
     * Call once when a run ends. ghostData: flat [x0,y0,x1,y1,…] world positions sampled at 10 Hz.
     * → {accepted, reason, rank, credits, ghostId, signedIn}
     */
    submitScore: function (run) {
      const r = run || {};
      return call('submitScore', {
        score: r.score, survivalTime: r.survivalTime, seed: r.seed, metadata: r.metadata || null, ghostData: r.ghostData || null,
      }, { accepted: false, reason: 'offline', rank: null, credits: 0, ghostId: null, signedIn: false }, 15000);
    },

    wallet: {
      /** → {credits, gems, vip, signedIn} */
      getBalance: function () { return call('wallet.getBalance', null, { credits: 0, gems: 0, vip: false, signedIn: false }); },
      /** Server-capped (ADR 0010). → {granted, balance} */
      grant: function (amount, reason) { return call('wallet.grant', { amount: amount, reason: reason }, { granted: 0, balance: null }); },
      /** Buys a catalog item; the price comes from the server catalog. → {ok, reason, balance} */
      spend: function (cost, itemId) { return call('wallet.spend', { cost: cost, itemId: itemId }, { ok: false, reason: 'offline', balance: null }); },
    },

    ads: {
      /** → {granted, reason}. VIP players are granted instantly. Long timeout: the ad itself takes time. */
      showRewarded: function (placementId) {
        return call('ads.showRewarded', { placement: placementId }, { granted: false, reason: 'timeout' }, 120000);
      },
    },

    share: {
      challengeUrl: challengeUrl,
      /** Host formats + copies the challenge card. → {copied, url, text} */
      challenge: function (data) {
        const d = data || {};
        return call('share.challenge', { score: d.score, timeline: d.timeline, seed: d.seed, ghost: d.ghost }, { copied: false, url: challengeUrl(d), text: '' });
      },
    },

    save: {
      /** Cloud save for signed-in players. → {data|null} */
      get: function () { return call('save.get', null, { data: null }); },
      set: function (data) { return call('save.set', { data: data }, { ok: false }); },
    },

    ghost: {
      /** → {seed, frames, hz, name, score} | null */
      get: function (id) { return call('ghost.get', { id: id }, null); },
    },

    /** Gameplay state, for ad pacing ("no ads mid-run") and pausing the theater's own effects. */
    gameplay: function (active) { call('gameplay', { active: Boolean(active) }, null, 2000); },

    /** Host events: 'pause' (a portal dialog opened), 'resume', 'trail' (equipped trail changed). */
    on: function (name, fn) {
      if (typeof fn !== 'function') return;
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(fn);
    },
    off: function (name, fn) {
      const fns = listeners.get(name);
      if (fns) listeners.set(name, fns.filter(function (f) { return f !== fn; }));
    },
  };

  Object.freeze(sdk.wallet);
  Object.freeze(sdk.ads);
  Object.freeze(sdk.share);
  Object.freeze(sdk.save);
  Object.freeze(sdk.ghost);
  Object.defineProperty(self, 'ArcadeSDK', { value: Object.freeze(sdk), writable: false, configurable: false, enumerable: true });
})();
