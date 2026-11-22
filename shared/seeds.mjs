// Seeds and challenge links. URL input is untrusted: everything is whitelisted here before use.
import { dayIndex } from './util.mjs';

export const SEED_RE = /^[A-Z0-9-]{1,32}$/;
export const GHOST_ID_RE = /^[a-f0-9]{32}$/;
export const BEAT_RE = /^\d{1,9}$/;

export function sanitizeSeed(raw) {
  if (typeof raw !== 'string') return null;
  const seed = raw.trim().toUpperCase();
  return SEED_RE.test(seed) ? seed : null;
}

/** `?seed=&beat=&ghost=` → sanitized values (beat/ghost only count with a seed). */
export function parseChallengeParams(search) {
  const params = new URLSearchParams(search);
  const seed = sanitizeSeed(params.get('seed'));
  const beatRaw = params.get('beat');
  const ghostRaw = params.get('ghost');
  return {
    seed,
    beat: seed && beatRaw && BEAT_RE.test(beatRaw) ? Number(beatRaw) : null,
    ghost: seed && ghostRaw && GHOST_ID_RE.test(ghostRaw) ? ghostRaw : null,
  };
}

/** One featured game per UTC day, rotating evenly through the live games. */
export function featuredGame(day, games) {
  if (!games.length) return null;
  const n = games.length;
  return games[((dayIndex(day) % n) + n) % n];
}

/** Builds a clean challenge link to the game's theater page. */
export function challengeUrl(siteUrl, slug, { seed, beat, ghost } = {}) {
  const url = new URL(`/games/${slug}/`, siteUrl);
  if (seed) url.searchParams.set('seed', seed);
  if (seed && Number.isFinite(beat) && beat > 0) url.searchParams.set('beat', String(Math.floor(beat)));
  if (seed && typeof ghost === 'string' && GHOST_ID_RE.test(ghost)) url.searchParams.set('ghost', ghost);
  return url.toString();
}
