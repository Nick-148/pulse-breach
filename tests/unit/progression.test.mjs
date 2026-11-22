import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGame, memoryStorage } from '../helpers/load-game.mjs';

const PB = loadGame();

test('storage keys are namespaced under pulse_breach_v1_', () => {
  const backend = memoryStorage();
  const store = new PB.Store(backend);
  store.write('profile', { scrap: 1 });
  assert.deepEqual(backend.keys(), ['pulse_breach_v1_profile']);
  assert.deepEqual({ ...store.read('profile') }, { scrap: 1 });
});

test('Store survives corrupt JSON and a missing/throwing backend', () => {
  const backend = memoryStorage();
  backend.setItem('pulse_breach_v1_profile', '{not json');
  assert.equal(new PB.Store(backend).read('profile'), null);
  assert.equal(new PB.Store(null).read('profile'), null);
  assert.equal(new PB.Store(null).write('profile', {}), false);
  const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } };
  assert.equal(new PB.Store(throwing).read('x'), null);
  assert.equal(new PB.Store(throwing).write('x', 1), false);
});

test('sanitizeProfile clamps tampered or stale data', () => {
  const p = PB.sanitizeProfile({ scrap: -50, upgrades: { magnet: 9, dash: '2', aegis: 1.7 }, themes: ['pulse', 'nope', 'ice'], theme: 'nope', runs: NaN });
  assert.equal(p.scrap, 0);
  assert.deepEqual({ ...p.upgrades }, { magnet: 3, dash: 0, aegis: 1 });
  assert.deepEqual([...p.themes], ['pulse', 'ice']);
  assert.equal(p.theme, 'pulse');
  assert.equal(p.runs, 0);
  assert.deepEqual(PB.sanitizeProfile('garbage'), PB.defaultProfile());
});

test('upgrades cost scrap, cap at tier 3, and refuse when broke', () => {
  let p = { ...PB.defaultProfile(), scrap: 1000 };
  const costs = [];
  for (let i = 0; i < 3; i++) {
    costs.push(PB.upgradeCost(p, 'dash'));
    const r = PB.buyUpgrade(p, 'dash');
    assert.equal(r.ok, true);
    p = r.profile;
  }
  assert.deepEqual(costs, [...PB.UPGRADES.dash.costs]);
  assert.equal(p.upgrades.dash, 3);
  assert.equal(p.scrap, 1000 - costs.reduce((a, b) => a + b, 0));
  assert.equal(PB.buyUpgrade(p, 'dash').reason, 'maxed');
  assert.equal(PB.buyUpgrade({ ...PB.defaultProfile(), scrap: 5 }, 'magnet').reason, 'funds');
  assert.equal(PB.buyUpgrade(p, '__proto__').reason, 'unknown');
});

test('loadout maps tiers to gameplay values', () => {
  const l = PB.loadoutFrom({ ...PB.defaultProfile(), upgrades: { magnet: 2, dash: 3, aegis: 2 } });
  assert.equal(l.magnetRadius, PB.UPGRADES.magnet.values[2]);
  assert.equal(l.dashCooldown, 0.7);
  assert.equal(l.shieldCharges, 1);
  assert.equal(l.shockwave, true);
});

test('themes unlock with scrap, then equip for free', () => {
  const p0 = { ...PB.defaultProfile(), scrap: 200 };
  const r1 = PB.selectTheme(p0, 'toxic');
  assert.equal(r1.ok, true);
  assert.equal(r1.profile.scrap, 50);
  assert.equal(r1.profile.theme, 'toxic');
  assert.equal(PB.selectTheme(r1.profile, 'solar').reason, 'funds');
  const back = PB.selectTheme(r1.profile, 'pulse');
  assert.equal(back.profile.scrap, 50);
  assert.equal(PB.THEMES.length, 5, 'default + 4 unlockable palettes');
});

test('scrap payout grows with score and survival', () => {
  assert.equal(PB.scrapForRun(0, 0), 0);
  assert.equal(PB.scrapForRun(1000, 30.9), 5 + 30);
  assert.equal(PB.addScrap({ scrap: 9_999_990 }, 100).scrap, 1e7, 'bank is capped');
});

test('daily attempts and streaks follow UTC days', () => {
  let d = PB.defaultDaily();
  d = PB.registerDailyAttempt(d, '2026-11-20');
  assert.equal(d.streak, 1);
  d = PB.registerDailyAttempt(d, '2026-11-20');
  assert.equal(d.attempts, 2);
  assert.equal(d.streak, 1, 'replays the same day do not inflate the streak');
  d = PB.recordDailyResult(d, '2026-11-20', 5000, 33.3);
  d = PB.registerDailyAttempt(d, '2026-11-21');
  assert.equal(d.streak, 2);
  assert.equal(d.attempts, 1, 'attempts reset each day');
  assert.equal(d.best, 0, 'best resets each day');
  assert.equal(PB.currentStreak(d, '2026-11-22'), 2, 'alive until the day after');
  assert.equal(PB.currentStreak(d, '2026-11-23'), 0, 'broken after a missed day');
  d = PB.registerDailyAttempt(d, '2026-11-25');
  assert.equal(d.streak, 1);
  assert.equal(d.bestStreak, 2);
});

test('recordDailyResult only keeps improvements for the same day', () => {
  let d = PB.registerDailyAttempt(PB.defaultDaily(), '2026-11-21');
  d = PB.recordDailyResult(d, '2026-11-21', 900, 20);
  d = PB.recordDailyResult(d, '2026-11-21', 500, 10);
  assert.equal(d.best, 900);
  assert.equal(PB.recordDailyResult(d, '2026-11-22', 99999, 60).best, 900);
});

test('timeline renders 6 spoiler-free blocks', () => {
  const seg = (maxMult = 1, closeCall = false) => ({ maxMult, closeCall });
  const segments = [seg(), seg(), seg(2, true), seg(7), seg(), seg()];
  assert.equal(PB.buildTimeline(segments, 4), '🟩🟩🟨🔥💀⬛');
  assert.equal(PB.buildTimeline(segments, -1), '🟩🟩🟨🔥🟩🟩');
});

test('share text carries timeline, stats, honesty markers and a challenge URL', () => {
  const url = PB.challengeUrl('https://pulsebreach.io/?utm=x#frag', 'DAILY-2026-11-21', 12340);
  assert.equal(url, 'https://pulsebreach.io/?seed=DAILY-2026-11-21&beat=12340');
  const text = PB.buildShareText({
    seed: 'DAILY-2026-11-21', timeline: '🟩🟩🟨🔥💀⬛', survival: 43.21, score: 12340, maxMult: 8, url, revived: true,
    tiers: { magnet: 2, dash: 1, aegis: 0 },
  });
  assert.match(text, /DAILY-2026-11-21/);
  assert.match(text, /🟩🟩🟨🔥💀⬛/);
  assert.match(text, /43\.2s/);
  assert.match(text, /12,340/);
  assert.match(text, /✖8/);
  assert.match(text, /revived/);
  assert.match(text, /M2·D1·A0/);
  assert.ok(text.endsWith(url));
  const clean = PB.buildShareText({ seed: 'X', timeline: '', survival: 1, score: 1, maxMult: 1, url, revived: false, tiers: { magnet: 0, dash: 0, aegis: 0 } });
  assert.doesNotMatch(clean, /revived|🛠/);
});

test('runAdBreak grants only when the ad was viewed', async () => {
  const viewed = await PB.runAdBreak((o) => { o.beforeReward(() => { o.beforeAd(); o.afterAd(); o.adViewed(); o.adBreakDone({ breakStatus: 'viewed' }); }); }, 'revive');
  assert.deepEqual({ ...viewed }, { granted: true, reason: 'viewed' });
  const dismissed = await PB.runAdBreak((o) => { o.beforeReward(() => { o.adDismissed(); o.adBreakDone({ breakStatus: 'dismissed' }); }); }, 'revive');
  assert.equal(dismissed.granted, false);
  const notReady = await PB.runAdBreak((o) => o.adBreakDone({ breakStatus: 'notReady' }), 'revive');
  assert.equal(notReady.granted, false);
});

test('withTimeout resolves a hung SDK call as not granted', async () => {
  const r = await PB.withTimeout(new Promise(() => {}), 10);
  assert.deepEqual({ ...r }, { granted: false, reason: 'timeout' });
  const e = await PB.withTimeout(Promise.reject(new Error('boom')), 1000);
  assert.equal(e.granted, false);
});

test('profiles carry a savedAt stamp for cloud-save conflict resolution (sanitized)', () => {
  assert.equal(PB.defaultProfile().savedAt, 0);
  assert.equal(PB.sanitizeProfile({ savedAt: 1795300000000 }).savedAt, 1795300000000);
  assert.equal(PB.sanitizeProfile({ savedAt: 'soon' }).savedAt, 0);
  assert.equal(PB.sanitizeProfile({ savedAt: -5 }).savedAt, 0);
});
