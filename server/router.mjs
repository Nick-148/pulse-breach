// API entry point: routing, CSRF guard, error mapping. Used by functions/api/[[path]].js on Cloudflare and by
// scripts/serve.mjs + tests locally (same code, node:sqlite instead of D1).
import { GAMES } from '../shared/games.mjs';
import { featuredGame } from '../shared/seeds.mjs';
import { dailyQuests, questText } from '../shared/quests.mjs';
import { HttpError, assertSameOrigin, json } from './http.mjs';
import { createContext } from './context.mjs';
import { pruneRateLimits, exec } from './db.mjs';
import { register, login, logout, deleteAccount, providerList, providerNotConfigured } from './auth.mjs';
import { startRun, submitScore, leaderboard, trending, ghost } from './play.mjs';
import { me, checkin, mergeGuest, claimQuest, walletGrant, walletSpend, equip, getSave, putSave, listFriends, addFriend, removeFriend } from './account.mjs';
import { catalog, checkout, webhook, paymentProvider } from './payments.mjs';

function config(ctx) {
  const titles = Object.fromEntries(GAMES.map((g) => [g.slug, g.title]));
  const payments = paymentProvider(ctx.env);
  return json({
    day: ctx.day,
    serverTime: ctx.now,
    featured: featuredGame(ctx.day, GAMES)?.slug || null,
    leaderboards: Boolean(ctx.env.RUN_SECRET && ctx.env.RUN_SECRET.length >= 32),
    auth: providerList(ctx.env),
    payments: { provider: payments.id, enabled: payments.enabled },
    quests: dailyQuests(ctx.day, GAMES.map((g) => g.slug)).map((q) => ({ ...q, text: questText(q, titles) })),
  });
}

const health = (ctx) => json({ ok: true, db: Boolean(ctx.env.DB) });

// [method, pattern, handler, options]. `:name` captures one path segment.
const ROUTES = [
  ['GET', '/api/health', health, { db: false }],
  ['GET', '/api/config', config, { db: false }],
  ['POST', '/api/auth/register', register],
  ['POST', '/api/auth/login', login],
  ['POST', '/api/auth/logout', logout],
  ['GET', '/api/auth/google/start', providerNotConfigured, { db: false }],
  ['POST', '/api/auth/magic/start', providerNotConfigured, { db: false }],
  ['GET', '/api/me', me],
  ['DELETE', '/api/me', deleteAccount],
  ['POST', '/api/me/checkin', checkin],
  ['POST', '/api/me/merge', mergeGuest],
  ['POST', '/api/me/equip', equip],
  ['POST', '/api/runs', startRun],
  ['POST', '/api/scores', submitScore],
  ['GET', '/api/boards/:game', leaderboard],
  ['GET', '/api/trending', trending],
  ['GET', '/api/ghosts/:id', ghost],
  ['POST', '/api/quests/:id/claim', claimQuest],
  ['POST', '/api/wallet/grant', walletGrant],
  ['POST', '/api/wallet/spend', walletSpend],
  ['GET', '/api/saves/:game', getSave],
  ['PUT', '/api/saves/:game', putSave],
  ['GET', '/api/friends', listFriends],
  ['POST', '/api/friends', addFriend],
  ['DELETE', '/api/friends/:code', removeFriend],
  ['GET', '/api/store/catalog', catalog, { db: false }],
  ['POST', '/api/store/checkout', checkout],
  // Called by Stripe's servers: authenticated by signature instead of Origin/cookie.
  ['POST', '/api/store/webhook', webhook, { csrf: false }],
].map(([method, pattern, handler, opts = {}]) => {
  const names = [];
  const re = new RegExp(`^${pattern.replace(/:([a-z]+)/g, (_, n) => { names.push(n); return '([A-Za-z0-9_-]{1,64})'; })}$`);
  return { method, re, names, handler, db: opts.db !== false, csrf: opts.csrf !== false };
});

function match(method, pathname) {
  let pathMatched = false;
  for (const r of ROUTES) {
    const m = r.re.exec(pathname);
    if (!m) continue;
    pathMatched = true;
    if (r.method !== method) continue;
    return { route: r, params: Object.fromEntries(r.names.map((n, i) => [n, m[i + 1]])) };
  }
  return pathMatched ? 'method' : null;
}

/** `waitUntil` lets background cleanup outlive the response on Workers (optional locally). */
export async function handleApi(request, env, waitUntil = (p) => p.catch(() => {})) {
  const url = new URL(request.url);
  const found = match(request.method, url.pathname);
  if (found === null) return json({ error: 'not-found' }, 404);
  if (found === 'method') return json({ error: 'method-not-allowed' }, 405);
  const { route, params } = found;
  const ctx = createContext(request, env, url);
  try {
    if (route.db && !env.DB) throw new HttpError(503, 'backend-offline');
    if (route.csrf && request.method !== 'GET' && request.method !== 'HEAD') assertSameOrigin(request, url);
    const res = await route.handler(ctx, params);
    for (const c of ctx.cookies) res.headers.append('Set-Cookie', c);
    if (env.DB && Math.random() < 0.01) {
      waitUntil(Promise.all([pruneRateLimits(env.DB, ctx.now), exec(env.DB, 'DELETE FROM sessions WHERE expires_at < ?', ctx.now)]));
    }
    return res;
  } catch (err) {
    if (err instanceof HttpError) {
      const res = json({ error: err.code, ...err.extra }, err.status);
      for (const c of ctx.cookies) res.headers.append('Set-Cookie', c);
      return res;
    }
    console.error('api-error', route.method, url.pathname, err && err.stack ? err.stack : err);
    return json({ error: 'internal' }, 500);
  }
}
