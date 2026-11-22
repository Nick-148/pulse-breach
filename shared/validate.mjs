// Score submission validation (ADR 0010). Pure and shared: the server enforces it, the portal uses it to
// skip doomed requests, and unit tests pin the rules.
import { deepFreeze, isObj } from './util.mjs';

export const LIMITS = deepFreeze({
  tokenMaxAgeMs: 24 * 3600_000,
  clockToleranceMs: 1500,
  metaMaxBytes: 1024,
  ghostHz: 10,
  ghostMaxPoints: 3000,
  ghostMargin: 64,
});

const TOKEN_RE = /^[A-Za-z0-9_-]{16,600}\.[A-Za-z0-9_-]{16,100}$/;
const META_KEY_RE = /^[a-zA-Z0-9_]{1,24}$/;

const fail = (reason) => ({ ok: false, reason });

/** Shape-checks an untrusted submission body. Returns only whitelisted, normalized fields. */
export function validateRunBody(body) {
  if (!isObj(body)) return fail('bad-body');
  const { token, score, survivalMs } = body;
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return fail('bad-token');
  if (!Number.isSafeInteger(score) || score < 0 || score > 1e9) return fail('bad-score');
  if (!Number.isSafeInteger(survivalMs) || survivalMs < 0 || survivalMs > 36e5) return fail('bad-survival');

  const meta = {};
  if (body.meta !== undefined && body.meta !== null) {
    if (!isObj(body.meta)) return fail('bad-meta');
    const entries = Object.entries(body.meta);
    if (entries.length > 12) return fail('bad-meta');
    for (const [k, v] of entries) {
      if (!META_KEY_RE.test(k)) return fail('bad-meta');
      if (typeof v === 'string') meta[k] = v.slice(0, 64);
      else if (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) meta[k] = v;
      else return fail('bad-meta');
    }
    if (JSON.stringify(meta).length > LIMITS.metaMaxBytes) return fail('bad-meta');
  }

  let ghost = null;
  if (body.ghost !== undefined && body.ghost !== null) {
    const g = body.ghost;
    if (!Array.isArray(g) || g.length % 2 !== 0 || g.length > LIMITS.ghostMaxPoints * 2) return fail('bad-ghost');
    if (!g.every((n) => Number.isInteger(n) && Math.abs(n) < 1e5)) return fail('bad-ghost');
    ghost = g;
  }
  return { ok: true, value: { token, score, survivalMs, meta, ghost } };
}

/**
 * Plausibility checks against the verified token payload `{g, s, t}` and the game's registry bounds.
 * Game time can never run faster than wall-clock time, so survival must fit inside the token's age.
 */
export function checkPlausibility(game, run, token, now) {
  if (!game || token.g !== game.slug) return fail('wrong-game');
  if (token.t > now + 5000) return fail('token-from-future');
  if (now - token.t > LIMITS.tokenMaxAgeMs) return fail('token-expired');
  if (run.survivalMs > game.scoring.maxSurvivalMs) return fail('implausible-survival');
  if (run.survivalMs > now - token.t + LIMITS.clockToleranceMs) return fail('implausible-survival');
  if (run.score > game.scoring.maxScore(run.survivalMs / 1000)) return fail('implausible-score');
  if (run.ghost) {
    const points = run.ghost.length / 2;
    if (points > Math.ceil((run.survivalMs / 1000) * LIMITS.ghostHz) + 2) return fail('bad-ghost');
    const m = LIMITS.ghostMargin;
    for (let i = 0; i < run.ghost.length; i += 2) {
      const x = run.ghost[i];
      const y = run.ghost[i + 1];
      if (x < -m || x > game.world.w + m || y < -m || y > game.world.h + m) return fail('bad-ghost');
    }
  }
  return { ok: true };
}
