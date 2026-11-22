// Economy rules (ADR 0010). The server enforces these with SQL; guests apply the same rules locally
// (their numbers are untrusted and get capped again on merge).
import { clampInt, deepFreeze, isObj, shiftDay, DAY_RE } from './util.mjs';

export const ECONOMY = deepFreeze({
  runCreditsDailyCap: 400,
  featuredMultiplier: 2,
  adReward: 25,
  adDailyLimit: 8,
  gameBonusMaxPerGrant: 50,
  gameBonusDailyCapPerGame: 100,
  checkin: { base: 10, perStreakDay: 5, maxBonusDays: 6, vipMultiplier: 2 },
  guestMergeCap: 1000,
  maxBalance: 10_000_000,
});

/** Credits for one validated run: score-based, capped per run, doubled for the featured game. */
export function runCredits(game, score, featured) {
  const s = game.scoring;
  const base = Math.max(0, Math.min(s.maxRunCredits, Math.floor(clampInt(score, 0, 1e9, 0) / s.pointsPerCredit)));
  return base * (featured ? ECONOMY.featuredMultiplier : 1);
}

/**
 * Run credits are booked in two daily buckets so the featured-game bonus never eats into the normal cap:
 * normal runs share `runCreditsDailyCap`, featured-game runs get their own (doubled) cap.
 */
export function runBucket(featured) {
  return featured
    ? { reason: 'run_featured', cap: ECONOMY.runCreditsDailyCap * ECONOMY.featuredMultiplier }
    : { reason: 'run', cap: ECONOMY.runCreditsDailyCap };
}

/** Daily login streak: consecutive UTC days. Returns the new streak and whether today was already counted. */
export function nextStreak(lastDay, streak, today) {
  if (lastDay === today) return { streak: Math.max(1, streak), already: true };
  if (lastDay && lastDay === shiftDay(today, -1)) return { streak: streak + 1, already: false };
  return { streak: 1, already: false };
}

export function checkinReward(streak, vip) {
  const c = ECONOMY.checkin;
  const bonusDays = Math.min(c.maxBonusDays, Math.max(0, streak - 1));
  return (c.base + c.perStreakDay * bonusDays) * (vip ? c.vipMultiplier : 1);
}

/**
 * Client-requested grants (`ArcadeSDK.wallet.grant`). Returns the booked reason, the allowed amount and the
 * daily cap for that bucket, or null when the request is not grantable. Amounts never exceed the rule.
 */
export function grantRule(reason, amount, gameSlug) {
  if (reason === 'rewarded_ad') {
    return { reason: 'rewarded_ad', amount: ECONOMY.adReward, dailyCap: ECONOMY.adReward * ECONOMY.adDailyLimit };
  }
  const n = clampInt(amount, 0, ECONOMY.gameBonusMaxPerGrant, 0);
  if (!n || typeof gameSlug !== 'string') return null;
  return { reason: `game:${gameSlug}`, amount: n, dailyCap: ECONOMY.gameBonusDailyCapPerGame };
}

/* ------------------------------- Guest state ------------------------------ */

export const GUEST_ID_RE = /^g_[a-f0-9]{32}$/;
const MAX_PENDING = 3;
const MAX_RUNS_LOGGED = 60;

export function defaultGuest(id) {
  return {
    v: 1, id, credits: 0, streak: 0, lastCheckin: null,
    day: null, runs: [], claimed: [], ads: 0, runCredits: 0, featuredCredits: 0, bonus: {}, pending: [],
  };
}

const sanitizeRun = (r) => (isObj(r) && typeof r.game === 'string' && r.game.length <= 40
  ? { game: r.game, score: clampInt(r.score, 0, 1e9, 0), survivalMs: clampInt(r.survivalMs, 0, 36e5, 0) }
  : null);

const sanitizePending = (p) => (isObj(p) && typeof p.token === 'string' && p.token.length <= 600 && typeof p.game === 'string'
  ? {
    token: p.token,
    game: p.game.slice(0, 40),
    score: clampInt(p.score, 0, 1e9, 0),
    survivalMs: clampInt(p.survivalMs, 0, 36e5, 0),
    meta: isObj(p.meta) ? p.meta : {},
    ghost: Array.isArray(p.ghost) && p.ghost.length <= 8000 ? p.ghost.filter(Number.isFinite) : null,
    at: clampInt(p.at, 0, 1e15, 0),
  }
  : null);

/** Storage is untrusted (stale, edited, older version): rebuild the guest from validated fields only. */
export function sanitizeGuest(raw, newId) {
  const base = defaultGuest(isObj(raw) && GUEST_ID_RE.test(raw.id) ? raw.id : newId);
  if (!isObj(raw)) return base;
  const bonus = {};
  if (isObj(raw.bonus)) {
    for (const [k, v] of Object.entries(raw.bonus).slice(0, 20)) bonus[k.slice(0, 40)] = clampInt(v, 0, 1e6, 0);
  }
  return {
    ...base,
    credits: clampInt(raw.credits, 0, ECONOMY.maxBalance, 0),
    streak: clampInt(raw.streak, 0, 10_000, 0),
    lastCheckin: typeof raw.lastCheckin === 'string' && DAY_RE.test(raw.lastCheckin) ? raw.lastCheckin : null,
    day: typeof raw.day === 'string' && DAY_RE.test(raw.day) ? raw.day : null,
    runs: Array.isArray(raw.runs) ? raw.runs.slice(-MAX_RUNS_LOGGED).map(sanitizeRun).filter(Boolean) : [],
    claimed: Array.isArray(raw.claimed) ? raw.claimed.filter((c) => typeof c === 'string' && c.length <= 40).slice(0, 20) : [],
    ads: clampInt(raw.ads, 0, 1000, 0),
    runCredits: clampInt(raw.runCredits, 0, 1e6, 0),
    featuredCredits: clampInt(raw.featuredCredits, 0, 1e6, 0),
    bonus,
    pending: Array.isArray(raw.pending) ? raw.pending.slice(-MAX_PENDING).map(sanitizePending).filter(Boolean) : [],
  };
}

/** Day-scoped counters reset at UTC midnight. */
export function rollGuestDay(g, today) {
  if (g.day === today) return g;
  return { ...g, day: today, runs: [], claimed: [], ads: 0, runCredits: 0, featuredCredits: 0, bonus: {} };
}

export function guestCheckin(g, today) {
  const { streak, already } = nextStreak(g.lastCheckin, g.streak, today);
  if (already) return { guest: g, reward: 0, streak };
  const reward = checkinReward(streak, false);
  return { guest: { ...g, streak, lastCheckin: today, credits: Math.min(ECONOMY.maxBalance, g.credits + reward) }, reward, streak };
}

export function guestRecordRun(g, game, run, featured, today) {
  const rolled = rollGuestDay(g, today);
  const field = featured ? 'featuredCredits' : 'runCredits';
  const earned = Math.min(runCredits(game, run.score, featured), Math.max(0, runBucket(featured).cap - rolled[field]));
  const runs = [...rolled.runs, { game: game.slug, score: run.score, survivalMs: run.survivalMs }].slice(-MAX_RUNS_LOGGED);
  return {
    guest: { ...rolled, runs, [field]: rolled[field] + earned, credits: Math.min(ECONOMY.maxBalance, rolled.credits + earned) },
    earned,
  };
}

export function guestGrant(g, reason, amount, gameSlug, today) {
  const rule = grantRule(reason, amount, gameSlug);
  if (!rule) return { guest: g, granted: 0 };
  const rolled = rollGuestDay(g, today);
  const used = rule.reason === 'rewarded_ad' ? rolled.ads * ECONOMY.adReward : rolled.bonus[rule.reason] || 0;
  const granted = Math.max(0, Math.min(rule.amount, rule.dailyCap - used));
  if (!granted) return { guest: rolled, granted: 0 };
  const next = { ...rolled, credits: Math.min(ECONOMY.maxBalance, rolled.credits + granted) };
  if (rule.reason === 'rewarded_ad') next.ads = rolled.ads + 1;
  else next.bonus = { ...rolled.bonus, [rule.reason]: used + granted };
  return { guest: next, granted };
}

export function addPending(g, entry) {
  return { ...g, pending: [...g.pending.filter((p) => p.token !== entry.token), entry].slice(-MAX_PENDING) };
}

/** What a guest's local progress is worth when they sign in. Local numbers are untrusted: hard cap. */
export function planGuestMerge(g) {
  return { credits: Math.min(ECONOMY.guestMergeCap, clampInt(g.credits, 0, ECONOMY.maxBalance, 0)) };
}
