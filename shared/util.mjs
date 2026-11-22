// Small pure helpers shared by the portal (browser), the API (Workers) and tests (Node).
// Web-standard APIs only: no Node or DOM imports.

export function deepFreeze(obj) {
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) deepFreeze(value);
  }
  return Object.freeze(obj);
}

export const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Integer in [min, max], or `fallback` when `v` is not a finite number. */
export function clampInt(v, min, max, fallback = min) {
  return Number.isFinite(v) ? Math.min(max, Math.max(min, Math.floor(v))) : fallback;
}

export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function utcDay(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function shiftDay(day, days) {
  const [y, m, d] = day.split('-').map(Number);
  return utcDay(new Date(Date.UTC(y, m - 1, d + days)));
}

/** Whole days since 1970-01-01 for a YYYY-MM-DD string. */
export function dayIndex(day) {
  const [y, m, d] = day.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

export function msUntilNextUtcDay(now = Date.now()) {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  return next.getTime() - now;
}

/** FNV-1a 32-bit; deterministic selection (featured game, daily quests), not security. */
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export const fmtInt = (n) => Math.floor(Number(n) || 0).toLocaleString('en-US');
