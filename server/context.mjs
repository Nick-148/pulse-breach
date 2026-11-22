// Per-request context: lazy session lookup, privacy-preserving IP key, rate limiting, cookie queue.
import { utcDay } from '../shared/util.mjs';
import { HttpError, clientIp, parseCookies, sessionCookie, sessionCookieName } from './http.mjs';
import { sha256Hex, randomHex } from './crypto.mjs';
import { first, exec, rateLimit } from './db.mjs';

export const SESSION_TTL_MS = 30 * 86_400_000;
const RENEW_BELOW_MS = 15 * 86_400_000;
const SESSION_TOKEN_RE = /^[a-f0-9]{64}$/;

export function playerView(row) {
  return {
    id: row.id,
    username: row.username,
    friendCode: row.friend_code,
    vipUntil: Number(row.vip_until || 0),
    streak: Number(row.streak || 0),
    lastCheckin: row.last_checkin || null,
    equippedTrail: row.equipped_trail || null,
    createdAt: Number(row.created_at),
  };
}

export function createContext(request, env, url, now = Date.now()) {
  const ctx = {
    request,
    env,
    url,
    now,
    db: env.DB,
    day: utcDay(new Date(now)),
    cookies: [],
    sessionPromise: null,

    session() {
      if (!ctx.sessionPromise) ctx.sessionPromise = loadSession(ctx);
      return ctx.sessionPromise;
    },

    async player() {
      const s = await ctx.session();
      return s ? s.player : null;
    },

    async requirePlayer() {
      const p = await ctx.player();
      if (!p) throw new HttpError(401, 'sign-in-required');
      return p;
    },

    /** Daily-rotating salted hash: lets us rate-limit an IP without storing it (ADR 0009). */
    async ipKey() {
      const digest = await sha256Hex(`${clientIp(request)}|${ctx.day}|${env.RUN_SECRET || 'dev-salt'}`);
      return digest.slice(0, 32);
    },

    async limit(bucket, max, windowMs) {
      if (!(await rateLimit(ctx.db, bucket, max, windowMs, now))) throw new HttpError(429, 'rate-limited');
    },
  };
  return ctx;
}

async function loadSession(ctx) {
  const token = parseCookies(ctx.request.headers.get('Cookie'))[sessionCookieName(ctx.env)];
  if (!token || !SESSION_TOKEN_RE.test(token)) return null;
  const tokenHash = await sha256Hex(token);
  const row = await first(
    ctx.db,
    'SELECT s.expires_at AS session_expires, p.* FROM sessions s JOIN players p ON p.id = s.player_id WHERE s.token_hash = ? AND s.expires_at > ?',
    tokenHash, ctx.now,
  );
  if (!row) return null;
  if (Number(row.session_expires) - ctx.now < RENEW_BELOW_MS) {
    await exec(ctx.db, 'UPDATE sessions SET expires_at = ? WHERE token_hash = ?', ctx.now + SESSION_TTL_MS, tokenHash);
    ctx.cookies.push(sessionCookie(ctx.env, token, SESSION_TTL_MS / 1000));
  }
  return { tokenHash, player: playerView(row) };
}

/** New session for a player: only the SHA-256 of the cookie value is stored. */
export async function startSession(ctx, playerId) {
  const token = randomHex(32);
  await exec(ctx.db, 'DELETE FROM sessions WHERE player_id = ? AND expires_at <= ?', playerId, ctx.now);
  await exec(
    ctx.db,
    'INSERT INTO sessions (token_hash, player_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    await sha256Hex(token), playerId, ctx.now, ctx.now + SESSION_TTL_MS,
  );
  ctx.cookies.push(sessionCookie(ctx.env, token, SESSION_TTL_MS / 1000));
}

export function clearSessionCookie(ctx) {
  ctx.cookies.push(sessionCookie(ctx.env, '', 0));
}
