// Accounts (ADR 0009): username + server-generated Arcade Key. OAuth / magic link are registered providers
// that report disabled until the founder configures them (PLAN.md blockers B7, B8).
import { validateUsername, USERNAME_RE } from '../shared/names.mjs';
import { HttpError, json, readJson } from './http.mjs';
import { newArcadeKey, newFriendCode, normalizeArcadeKey, randomHex, sha256Hex, timingSafeEqual } from './crypto.mjs';
import { first, exec } from './db.mjs';
import { clearSessionCookie, playerView, startSession } from './context.mjs';

export const AUTH_PROVIDERS = Object.freeze([
  { id: 'username', label: 'Username + Arcade Key', enabled: () => true },
  // Needs an OAuth client (GOOGLE_CLIENT_ID/SECRET) and the redirect flow: PLAN.md B7.
  { id: 'google', label: 'Google', enabled: () => false },
  // Needs an email provider and stores email addresses (PII): PLAN.md B8.
  { id: 'magic', label: 'Email magic link', enabled: () => false },
]);

export const providerList = (env) => AUTH_PROVIDERS.map((p) => ({ id: p.id, label: p.label, enabled: p.enabled(env) }));

const DUMMY_HASH = '0'.repeat(64);

export async function register(ctx) {
  const body = await readJson(ctx.request, 4096);
  const v = validateUsername(body.username);
  if (!v.ok) throw new HttpError(400, v.reason);
  await ctx.limit(`register:${await ctx.ipKey()}`, 5, 3600_000);
  const usernameKey = v.name.toLowerCase();
  if (await first(ctx.db, 'SELECT 1 AS x FROM players WHERE username_key = ?', usernameKey)) throw new HttpError(409, 'username-taken');

  const key = newArcadeKey();
  const keyHash = await sha256Hex(normalizeArcadeKey(key));
  const id = randomHex(16);
  for (let attempt = 0; ; attempt++) {
    try {
      await exec(
        ctx.db,
        'INSERT INTO players (id, username, username_key, key_hash, friend_code, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        id, v.name, usernameKey, keyHash, newFriendCode(), ctx.now,
      );
      break;
    } catch (err) {
      const msg = String(err && err.message);
      if (msg.includes('players.username_key')) throw new HttpError(409, 'username-taken');
      if (!msg.includes('players.friend_code') || attempt >= 2) throw err; // friend-code collision: retry
    }
  }
  await startSession(ctx, id);
  const row = await first(ctx.db, 'SELECT * FROM players WHERE id = ?', id);
  // The key is returned exactly once; only its hash is stored.
  return json({ player: playerView(row), key }, 201);
}

export async function login(ctx) {
  const body = await readJson(ctx.request, 4096);
  const name = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
  const key = normalizeArcadeKey(body.key);
  await ctx.limit(`login:ip:${await ctx.ipKey()}`, 10, 15 * 60_000);
  const validName = USERNAME_RE.test(name);
  if (validName) await ctx.limit(`login:user:${name}`, 8, 15 * 60_000);
  const row = validName ? await first(ctx.db, 'SELECT * FROM players WHERE username_key = ?', name) : null;
  // Hash even when the user is unknown so response time doesn't reveal which usernames exist.
  const hash = await sha256Hex(key || 'no-key');
  const ok = timingSafeEqual(hash, row ? row.key_hash : DUMMY_HASH) && Boolean(row && key);
  if (!ok) throw new HttpError(401, 'bad-credentials');
  await startSession(ctx, row.id);
  return json({ player: playerView(row) });
}

export async function logout(ctx) {
  const s = await ctx.session();
  if (s) await exec(ctx.db, 'DELETE FROM sessions WHERE token_hash = ?', s.tokenHash);
  clearSessionCookie(ctx);
  return json({ ok: true });
}

export async function deleteAccount(ctx) {
  const player = await ctx.requirePlayer();
  const body = await readJson(ctx.request, 1024);
  if (typeof body.confirm !== 'string' || body.confirm.toLowerCase() !== player.username.toLowerCase()) {
    throw new HttpError(400, 'confirm-username');
  }
  await exec(ctx.db, 'DELETE FROM players WHERE id = ?', player.id); // ON DELETE CASCADE removes everything else
  clearSessionCookie(ctx);
  return json({ ok: true });
}

export function providerNotConfigured() {
  throw new HttpError(501, 'provider-not-configured');
}
