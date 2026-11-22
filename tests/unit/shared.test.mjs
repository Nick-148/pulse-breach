import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GAMES, gameBySlug } from '../../shared/games.mjs';
import { sanitizeSeed, parseChallengeParams, featuredGame, challengeUrl } from '../../shared/seeds.mjs';
import { dailyQuests, questProgress, questText, QUEST_POOL } from '../../shared/quests.mjs';
import { validateUsername } from '../../shared/names.mjs';
import { validateRunBody, checkPlausibility } from '../../shared/validate.mjs';
import {
  ECONOMY, runCredits, nextStreak, checkinReward, grantRule, sanitizeGuest, defaultGuest, guestCheckin,
  guestRecordRun, guestGrant, planGuestMerge, addPending, rollGuestDay,
} from '../../shared/economy.mjs';
import { shiftDay, dayIndex, utcDay } from '../../shared/util.mjs';
import { verifyToken, signToken, normalizeArcadeKey, newArcadeKey } from '../../server/crypto.mjs';

const PB = gameBySlug('pulse-breach');
const GID = `g_${'0'.repeat(32)}`;

test('registry: every game has the fields the portal, build and API rely on', () => {
  const slugs = new Set();
  for (const g of GAMES) {
    assert.match(g.slug, /^[a-z0-9-]+$/);
    assert.ok(!slugs.has(g.slug));
    slugs.add(g.slug);
    for (const k of ['title', 'subtitle', 'blurb', 'description', 'accent']) assert.equal(typeof g[k], 'string', `${g.slug}.${k}`);
    assert.ok(g.controls.length && g.strategy.length);
    assert.match(g.dailySeed('2026-11-21'), g.seedPattern);
    assert.ok(g.scoring.maxScore(60) > g.scoring.maxScore(10));
  }
});

test('seeds: URL input is whitelisted; beat/ghost only count with a seed', () => {
  assert.equal(sanitizeSeed(' daily-2026-11-21 '), 'DAILY-2026-11-21');
  for (const bad of ['<script>', 'a'.repeat(33), '', null, 'A B', 'é']) assert.equal(sanitizeSeed(bad), null);
  assert.deepEqual(parseChallengeParams('?seed=abc&beat=1200&ghost=' + 'a'.repeat(32)), { seed: 'ABC', beat: 1200, ghost: 'a'.repeat(32) });
  assert.deepEqual(parseChallengeParams('?beat=1200&ghost=' + 'a'.repeat(32)), { seed: null, beat: null, ghost: null });
  assert.deepEqual(parseChallengeParams('?seed=X&beat=1e9&ghost=../../etc'), { seed: 'X', beat: null, ghost: null });
  const url = challengeUrl('https://arcade.example', 'pulse-breach', { seed: 'DAILY-2026-11-21', beat: 14200.7, ghost: 'b'.repeat(32) });
  assert.equal(url, `https://arcade.example/games/pulse-breach/?seed=DAILY-2026-11-21&beat=14200&ghost=${'b'.repeat(32)}`);
});

test('featured game rotates through every game, one per UTC day', () => {
  const seen = new Set();
  for (let i = 0; i < GAMES.length; i++) seen.add(featuredGame(shiftDay('2026-11-21', i), GAMES).slug);
  assert.equal(seen.size, GAMES.length);
  assert.equal(featuredGame('2026-11-21', GAMES), featuredGame('2026-11-21', GAMES));
  assert.equal(dayIndex('1970-01-02'), 1);
  assert.equal(utcDay(new Date(Date.UTC(2026, 0, 1, 23, 59))), '2026-01-01');
});

test('daily quests: deterministic, one per game plus one cross-game, progress from runs', () => {
  const slugs = GAMES.map((g) => g.slug);
  const q = dailyQuests('2026-11-21', slugs);
  assert.deepEqual(q, dailyQuests('2026-11-21', slugs));
  assert.equal(q.length, slugs.length + 1);
  assert.equal(q[q.length - 1].game, null);
  const runs = [{ game: 'pulse-breach', score: 6000, survivalMs: 41_500 }, { game: 'neon-drift', score: 10, survivalMs: 1000 }];
  assert.deepEqual(questProgress(QUEST_POOL.find((x) => x.id === 'pb-score'), runs, 'x'), { value: 5000, target: 5000, done: true });
  assert.equal(questProgress(QUEST_POOL.find((x) => x.id === 'pb-survive'), runs, 'x').done, true);
  assert.equal(questProgress(QUEST_POOL.find((x) => x.id === 'two-games'), runs, 'x').done, true);
  assert.equal(questProgress(QUEST_POOL.find((x) => x.id === 'featured'), runs, 'neon-drift').value, 1);
  assert.equal(questText(QUEST_POOL[0], { 'pulse-breach': 'Pulse Breach' }), 'Score 5,000+ in Pulse Breach');
});

test('usernames: format, reserved and blocked names (with leetspeak), without Scunthorpe false positives', () => {
  assert.deepEqual(validateUsername(' Neon_Fox9 '), { ok: true, name: 'Neon_Fox9' });
  for (const ok of ['grapeJuice', 'Essex_Lad', 'Torpedo', 'Spicy_Taco', 'Cockpit', 'Dickens']) assert.equal(validateUsername(ok).ok, true, ok);
  assert.equal(validateUsername('admin').reason, 'username-reserved');
  assert.equal(validateUsername('Mod_Team').reason, 'username-reserved');
  assert.equal(validateUsername('sh1tlord').reason, 'username-blocked');
  assert.equal(validateUsername('xX_sex_Xx').reason, 'username-blocked');
  for (const bad of ['ab', 'a'.repeat(17), '___', '12345', 'a b', 'ñandu', 5]) assert.equal(validateUsername(bad).ok, false, String(bad));
});

test('economy: run credits, streaks, check-in rewards and grant rules', () => {
  assert.equal(runCredits(PB, 0, false), 0);
  assert.equal(runCredits(PB, 3000, false), 10);
  assert.equal(runCredits(PB, 1e9, false), 60);
  assert.equal(runCredits(PB, 1e9, true), 120);
  assert.equal(runCredits(PB, -50, false), 0);
  assert.deepEqual(nextStreak(null, 0, '2026-11-21'), { streak: 1, already: false });
  assert.deepEqual(nextStreak('2026-11-20', 4, '2026-11-21'), { streak: 5, already: false });
  assert.deepEqual(nextStreak('2026-11-21', 5, '2026-11-21'), { streak: 5, already: true });
  assert.deepEqual(nextStreak('2026-11-10', 9, '2026-11-21'), { streak: 1, already: false });
  assert.equal(checkinReward(1, false), 10);
  assert.equal(checkinReward(30, false), 40);
  assert.equal(checkinReward(30, true), 80);
  assert.deepEqual(grantRule('rewarded_ad', 1e6, null), { reason: 'rewarded_ad', amount: 25, dailyCap: 200 });
  assert.deepEqual(grantRule('anything', 999, 'neon-drift'), { reason: 'game:neon-drift', amount: 50, dailyCap: 100 });
  assert.equal(grantRule('anything', 0, 'neon-drift'), null);
  assert.equal(grantRule('anything', 10, null), null);
});

test('guest state: garbage storage is rebuilt safely; local rules mirror the server caps', () => {
  assert.deepEqual(sanitizeGuest('garbage', GID), defaultGuest(GID));
  const g = sanitizeGuest({ id: 'evil', credits: 1e12, streak: -5, runs: [{ game: 'x', score: 'NaN' }, 7], pending: [{ token: 5 }], bonus: { 'game:x': 1e9 } }, GID);
  assert.equal(g.id, GID);
  assert.equal(g.credits, ECONOMY.maxBalance);
  assert.equal(g.streak, 0);
  assert.deepEqual(g.runs, [{ game: 'x', score: 0, survivalMs: 0 }]);
  assert.deepEqual(g.pending, []);
  assert.equal(g.bonus['game:x'], 1e6);

  let guest = defaultGuest(GID);
  const c1 = guestCheckin(guest, '2026-11-21');
  assert.equal(c1.reward, 10);
  assert.equal(guestCheckin(c1.guest, '2026-11-21').reward, 0);
  guest = c1.guest;
  let earned = 0;
  for (let i = 0; i < 10; i++) {
    const r = guestRecordRun(guest, PB, { score: 1e6, survivalMs: 60_000 }, false, '2026-11-21');
    guest = r.guest;
    earned += r.earned;
  }
  assert.equal(earned, ECONOMY.runCreditsDailyCap);
  assert.equal(guest.runs.length, 10);
  let ads = 0;
  for (let i = 0; i < 12; i++) {
    const r = guestGrant(guest, 'rewarded_ad', 999, null, '2026-11-21');
    guest = r.guest;
    ads += r.granted;
  }
  assert.equal(ads, 200);
  const next = rollGuestDay(guest, '2026-11-22');
  assert.equal(next.runs.length, 0);
  assert.equal(next.ads, 0);
  assert.equal(next.credits, guest.credits, 'balance survives midnight');
  assert.equal(planGuestMerge({ credits: 5000 }).credits, ECONOMY.guestMergeCap);
  const p = addPending(addPending(addPending(addPending(guest, { token: 'a' }), { token: 'b' }), { token: 'c' }), { token: 'd' });
  assert.deepEqual(p.pending.map((x) => x.token), ['b', 'c', 'd']);
});

test('submission validation: shape, meta whitelist, plausibility vs wall clock and score bounds', () => {
  const token = `${'a'.repeat(20)}.${'b'.repeat(43)}`;
  const ok = validateRunBody({ token, score: 100, survivalMs: 5000, meta: { mode: 'daily', revived: true, tier: 2 }, ghost: [1, 2] });
  assert.equal(ok.ok, true);
  for (const bad of [
    { token: 'x', score: 1, survivalMs: 1 },
    { token, score: -1, survivalMs: 1 },
    { token, score: 1.5, survivalMs: 1 },
    { token, score: 1, survivalMs: 1, meta: { nested: { a: 1 } } },
    { token, score: 1, survivalMs: 1, meta: { 'bad key': 1 } },
    { token, score: 1, survivalMs: 1, ghost: [1] },
    { token, score: 1, survivalMs: 1, ghost: 'abc' },
  ]) assert.equal(validateRunBody(bad).ok, false, JSON.stringify(bad));
  assert.equal(validateRunBody({ token, score: 1, survivalMs: 1, meta: { long: 'x'.repeat(500) } }).value.meta.long.length, 64);

  const now = 1_000_000_000;
  const tok = { g: 'pulse-breach', t: now - 30_000 };
  const run = (o) => ({ score: 100, survivalMs: 20_000, ghost: null, ...o });
  assert.equal(checkPlausibility(PB, run({}), tok, now).ok, true);
  assert.equal(checkPlausibility(PB, run({ survivalMs: 40_000 }), tok, now).reason, 'implausible-survival');
  assert.equal(checkPlausibility(PB, run({ score: PB.scoring.maxScore(20) + 1 }), tok, now).reason, 'implausible-score');
  assert.equal(checkPlausibility(gameBySlug('neon-drift'), run({}), tok, now).reason, 'wrong-game');
  assert.equal(checkPlausibility(PB, run({}), { ...tok, t: now + 60_000 }, now).reason, 'token-from-future');
  assert.equal(checkPlausibility(PB, run({ ghost: new Array(2 * 250).fill(10) }), tok, now).reason, 'bad-ghost');
  assert.equal(checkPlausibility(PB, run({ ghost: [-100, 10] }), tok, now).reason, 'bad-ghost');
});

test('crypto: tokens are tamper-evident; Arcade Keys normalize and have the right shape', async () => {
  const secret = 's'.repeat(40);
  const t = await signToken({ a: 1 }, secret);
  assert.deepEqual(await verifyToken(t, secret), { a: 1 });
  assert.equal(await verifyToken(t, 'x'.repeat(40)), null);
  assert.equal(await verifyToken(`${t}x`, secret), null);
  assert.equal(await verifyToken(`${t}.extra`, secret), null);
  assert.equal(await verifyToken('garbage', secret), null);
  const key = newArcadeKey();
  assert.match(key, /^[A-HJKMNP-Z2-9]{5}(-[A-HJKMNP-Z2-9]{5}){3}$/);
  assert.equal(normalizeArcadeKey(key.toLowerCase().replace(/-/g, ' ')), key.replace(/-/g, ''));
  assert.equal(normalizeArcadeKey('short'), null);
  assert.equal(new Set(Array.from({ length: 50 }, newArcadeKey)).size, 50);
});
