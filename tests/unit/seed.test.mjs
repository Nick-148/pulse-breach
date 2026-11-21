import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGame } from '../helpers/load-game.mjs';

const PB = loadGame();

test('mulberry32 is deterministic and in [0, 1)', () => {
  const a = PB.mulberry32(42);
  const b = PB.mulberry32(42);
  for (let i = 0; i < 1000; i++) {
    const x = a();
    assert.equal(x, b());
    assert.ok(x >= 0 && x < 1);
  }
});

test('mulberry32 differs across seeds and is roughly uniform', () => {
  const r = PB.mulberry32(7);
  const buckets = new Array(10).fill(0);
  for (let i = 0; i < 20000; i++) buckets[Math.floor(r() * 10)]++;
  for (const n of buckets) assert.ok(n > 1700 && n < 2300, `bucket ${n}`);
  assert.notEqual(PB.mulberry32(1)(), PB.mulberry32(2)());
});

test('hashString is stable, 32-bit, and avalanches on similar input', () => {
  assert.equal(PB.hashString('DAILY-2026-11-21'), PB.hashString('DAILY-2026-11-21'));
  const h = PB.hashString('abc');
  assert.ok(Number.isInteger(h) && h >= 0 && h <= 0xffffffff);
  assert.notEqual(PB.hashString('DAILY-2026-11-21'), PB.hashString('DAILY-2026-11-22'));
});

test('daily seed uses the UTC date, not local time', () => {
  assert.equal(PB.dailySeedFor(new Date('2026-11-21T23:59:59Z')), 'DAILY-2026-11-21');
  assert.equal(PB.dailySeedFor(new Date('2026-11-22T00:00:00Z')), 'DAILY-2026-11-22');
  assert.equal(PB.shiftDateString('2026-03-01', -1), '2026-02-28');
  assert.equal(PB.shiftDateString('2026-12-31', 1), '2027-01-01');
});

test('sanitizeSeed whitelists characters and length (URL input is untrusted)', () => {
  assert.equal(PB.sanitizeSeed(' abc-123 '), 'ABC-123');
  assert.equal(PB.sanitizeSeed('<img src=x onerror=alert(1)>'), null);
  assert.equal(PB.sanitizeSeed('a'.repeat(33)), null);
  assert.equal(PB.sanitizeSeed(''), null);
  assert.equal(PB.sanitizeSeed(null), null);
  assert.equal(PB.sanitizeSeed('seed with space'), null);
});

test('parseLaunchParams reads ?seed and only trusts numeric ?beat', () => {
  assert.deepEqual({ ...PB.parseLaunchParams('?seed=friend1&beat=12340') }, { seed: 'FRIEND1', beat: 12340, debug: false });
  assert.equal(PB.parseLaunchParams('?seed=friend1&beat=1e9').beat, null);
  assert.equal(PB.parseLaunchParams('?beat=500').beat, null, 'beat without a seed is ignored');
  assert.equal(PB.parseLaunchParams('?seed=%3Cscript%3E').seed, null);
});

test('randomSeed produces readable practice seeds', () => {
  let i = 0;
  const seed = PB.randomSeed(() => i++ % 32);
  assert.match(seed, /^P-[A-Z2-9]{6}$/);
  assert.equal(PB.sanitizeSeed(seed), seed);
});
