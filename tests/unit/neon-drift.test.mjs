import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGame } from '../helpers/load-game.mjs';
import { makeBot } from '../helpers/neon-drift-bot.mjs';
import { gameBySlug } from '../../shared/games.mjs';
import { checkPlausibility } from '../../shared/validate.mjs';

const ND = loadGame('neon-drift', 'NeonDrift');
const SEED = 'DAILY-2026-11-21';
const plain = (x) => JSON.parse(JSON.stringify(x));
const run = (engine, dt, seconds, input) => {
  for (let i = 0; i < Math.round(seconds / dt) && engine.state === 'running'; i++) engine.update(dt, typeof input === 'function' ? input(engine) : input);
  return engine;
};

test('segments are a pure function of (seed, k): same seed same field, sorted, inside their 10 s window', () => {
  for (let k = 0; k < 10; k++) {
    const a = ND.generateSegment(SEED, k);
    assert.deepEqual(plain(a), plain(ND.generateSegment(SEED, k)));
    for (let i = 0; i < a.events.length; i++) {
      assert.ok(a.events[i].t >= k * 10 && a.events[i].t < (k + 1) * 10);
      if (i) assert.ok(a.events[i].t >= a.events[i - 1].t);
    }
    for (const b of a.beacons) assert.ok(b.x > 0 && b.x < ND.W && b.y > 0 && b.y < ND.H);
  }
  assert.notDeepEqual(plain(ND.generateSegment(SEED, 0)), plain(ND.generateSegment('OTHER', 0)));
});

test('difficulty ramps: fewer anchors, more mines, sweepers from field 4; calm first 3 seconds', () => {
  assert.equal(ND.generateSegment(SEED, 0).beacons.length, 6);
  assert.equal(ND.generateSegment(SEED, 2).beacons.length, 5);
  assert.equal(ND.generateSegment(SEED, 5).beacons.length, 4);
  const mines = (k) => ND.generateSegment(SEED, k).events.filter((e) => e.type === 'mine').length;
  assert.ok(mines(5) > mines(0));
  assert.ok(ND.generateSegment(SEED, 0).events.filter((e) => e.type === 'mine').every((e) => e.t >= 3));
  assert.ok(!ND.generateSegment(SEED, 2).events.some((e) => e.type === 'sweeper'));
  assert.ok(ND.generateSegment(SEED, 4).events.some((e) => e.type === 'sweeper'));
});

test('a run is identical at 60, 120 and 144 Hz (idle and holding)', () => {
  for (const input of [{ hold: false }, { hold: true }]) {
    const outcome = (dt) => {
      const e = run(new ND.DriftEngine({ seed: SEED }), dt, 120, input);
      return plain({ tick: e.tick, score: Math.floor(e.score), fuel: e.fuel.toFixed(6), timeline: e.results().timeline, trace: e.trace });
    };
    const a = outcome(1 / 60);
    assert.deepEqual(outcome(1 / 120), a);
    assert.deepEqual(outcome(1 / 144), a);
  }
});

test('holding tethers to a beacon in range, swings faster, and a fast release scores a slingshot', () => {
  const events = [];
  const e = new ND.DriftEngine({ seed: SEED, onEvent: (t) => events.push(t) });
  const b = e.activeBeacons()[0];
  Object.assign(e.ship, { x: b.x + 150, y: b.y, vx: 0, vy: 250 });
  run(e, 1 / 60, 0.1, { hold: true });
  assert.ok(e.ship.tether, 'tethered');
  assert.ok(events.includes('tether'));
  const r0 = Math.hypot(e.ship.x - b.x, e.ship.y - b.y);
  assert.ok(Math.abs(r0 - e.ship.tether.r) < 1e-6, 'stays on the tether circle');
  const speed0 = e.ship.speed;
  e.fuel = 100;
  run(e, 1 / 60, 3, (eng) => { eng.fuel = 100; return { hold: true }; });
  assert.ok(e.ship.speed > speed0 + 100, 'tension builds speed');
  const before = e.score;
  e.update(1 / 60, { hold: false });
  assert.equal(e.ship.tether, null);
  assert.equal(e.stats.slings, 1);
  assert.ok(e.score - before >= ND.CONFIG.score.sling);
});

test('walls bounce (fuel cost, combo reset) with a stun that prevents chained penalties', () => {
  const e = new ND.DriftEngine({ seed: SEED });
  Object.assign(e.ship, { x: ND.W - 12, y: 200, vx: 400, vy: 0, speed: 400 });
  e.chain = 4;
  e.mult = 3;
  const fuel = e.fuel;
  e.update(1 / 120, { hold: false });
  assert.equal(e.stats.bounces, 1);
  assert.equal(e.mult, 1);
  assert.ok(e.ship.vx < 0, 'reflected');
  assert.ok(fuel - e.fuel >= ND.CONFIG.fuel.bounce);
  e.update(1 / 120, { hold: true });
  assert.equal(e.ship.tether, null, 'no instant re-tether right after a bounce');
  const afterFirst = e.fuel;
  Object.assign(e.ship, { x: ND.W - 12, vx: 400 });
  e.update(1 / 120, { hold: false });
  assert.equal(e.stats.bounces, 2);
  assert.ok(afterFirst - e.fuel < 1, 'second bounce inside the stun window is free');
});

test('salvage refuels and builds the haul multiplier; mines crash armed ships and graze once', () => {
  const e = new ND.DriftEngine({ seed: SEED });
  e.fuel = 50;
  for (let i = 0; i < 4; i++) e.salvage.push({ x: e.ship.x, y: e.ship.y, vx: 0, vy: 0, golden: false, age: 0, dead: false });
  e.updateSalvage(ND.STEP);
  assert.equal(e.stats.crates, 4);
  assert.equal(e.mult, 3);
  assert.ok(e.fuel > 50 + 3 * ND.CONFIG.fuel.crate);

  const g = new ND.DriftEngine({ seed: SEED });
  const R = ND.CONFIG.mine.radius + ND.CONFIG.skiff.radius;
  g.mines.push({ x: g.ship.x + R + 10, y: g.ship.y, vx: 0, vy: 0, sweeper: false, age: 5, dead: false, grazed: false, armed: true });
  g.updateMines(ND.STEP);
  g.updateMines(ND.STEP);
  assert.equal(g.stats.grazes, 1);
  assert.equal(g.state, 'running');
  g.mines.push({ x: g.ship.x, y: g.ship.y, vx: 0, vy: 0, sweeper: false, age: 5, dead: false, grazed: false, armed: true });
  g.updateMines(ND.STEP);
  assert.equal(g.state, 'breach');
  assert.equal(g.deathCause, 'mine');
});

test('a mine never arms on top of the skiff', () => {
  const e = new ND.DriftEngine({ seed: SEED });
  e.mines.push({ x: e.ship.x, y: e.ship.y, vx: 0, vy: 0, sweeper: false, age: 2, dead: false, grazed: false, armed: false });
  e.updateMines(ND.STEP);
  assert.equal(e.state, 'running');
  assert.equal(e.mines[0].armed, false);
});

test('running out of fuel ends the run; revive restores fuel, shields, clears mines, once', () => {
  const e = run(new ND.DriftEngine({ seed: SEED }), 1 / 60, 300, { hold: false });
  assert.equal(e.state, 'breach');
  const e2 = new ND.DriftEngine({ seed: SEED });
  e2.fuel = 0.01;
  e2.update(1 / 60, { hold: false });
  assert.equal(e2.deathCause, 'fuel');
  e2.mines.push({ x: e2.ship.x + 20, y: e2.ship.y, vx: 0, vy: 0, sweeper: false, age: 5, dead: false, grazed: false, armed: true });
  const t = e2.time;
  assert.equal(e2.revive(), true);
  assert.equal(e2.time, t);
  assert.equal(e2.state, 'running');
  assert.ok(e2.fuel >= ND.CONFIG.revive.fuel);
  assert.equal(e2.invuln, ND.CONFIG.revive.invuln);
  assert.equal(e2.mines.length, 0);
  e2.fuel = 0.01;
  e2.update(1 / 60, { hold: false });
  assert.equal(e2.revive(), false, 'one revive per run');
  assert.equal(e2.results().revived, true);
});

test('non-finite frame times and junk input never corrupt the simulation', () => {
  const e = new ND.DriftEngine({ seed: SEED });
  e.update(NaN, { hold: 'yes' });
  e.update(Infinity, null);
  e.update(-1, undefined);
  assert.ok(Number.isFinite(e.ship.x) && Number.isFinite(e.ship.y));
  assert.ok(e.tick <= Math.ceil(ND.CONFIG && 0.05 / ND.STEP));
});

test('ghost trace is 10 Hz and every bot run passes the server plausibility check', () => {
  const game = gameBySlug('neon-drift');
  for (const seed of ['DAILY-2026-11-21', 'N-ABCDEF']) {
    const e = new ND.DriftEngine({ seed });
    const bot = makeBot(ND);
    run(e, 1 / 60, 300, (eng) => ({ hold: bot(eng, 1 / 60) }));
    const r = e.results();
    const verdict = checkPlausibility(game, { score: r.score, survivalMs: Math.round(r.survival * 1000), ghost: e.trace }, { g: 'neon-drift', t: 0 }, Math.round(r.survival * 1000) + 1000);
    assert.equal(verdict.ok, true, `${seed}: ${verdict.reason}`);
  }
});

test('balance: a simple bot gets a fair run on every sampled seed (no unwinnable fields)', () => {
  const seeds = ['DAILY-2026-11-21', 'DAILY-2026-11-22', 'DAILY-2026-11-23', 'DAILY-2026-12-01', 'N-ABCDEF', 'N-ZZZ999', 'X', 'DAILY-2027-01-01'];
  const times = seeds.map((seed) => {
    const e = new ND.DriftEngine({ seed });
    const bot = makeBot(ND);
    run(e, 1 / 60, 300, (eng) => ({ hold: bot(eng, 1 / 60) }));
    return e.results().survival;
  });
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  // Baseline 2026-11-21: mean 30.8 s, min 11.5 s. Re-tune deliberately if this fails (AGENTS.md → Testing).
  assert.ok(times.every((t) => t >= 8), `a seed killed the bot too fast: ${times.map((t) => t.toFixed(1))}`);
  assert.ok(mean >= 22, `mean bot survival ${mean.toFixed(1)} s`);
});

test('persistence: storage is re-validated, daily streak and attempts track UTC days', () => {
  assert.deepEqual(plain(ND.sanitizeProfile('garbage')), plain(ND.defaultProfile()));
  const p = ND.sanitizeProfile({ runs: -1, bestPractice: 'x', bestEver: 1e12, savedAt: 5 });
  assert.deepEqual(plain(p), { runs: 0, bestPractice: 0, bestEver: 1e9, savedAt: 5 });
  assert.deepEqual(plain(ND.sanitizeDaily({ date: '<b>', best: -5 })), plain(ND.defaultDaily()));
  let d = ND.registerDailyAttempt(ND.defaultDaily(), '2026-11-20');
  d = ND.registerDailyAttempt(d, '2026-11-21');
  d = ND.registerDailyAttempt(d, '2026-11-21');
  assert.equal(d.streak, 2);
  assert.equal(d.attempts, 2);
  assert.equal(ND.currentStreak(d, '2026-11-23'), 0);
  assert.equal(ND.recordDailyResult(d, '2026-11-21', 900).best, 900);
});

test('share card is spoiler-free and links to the same seed', () => {
  const text = ND.buildShareText({ seed: SEED, timeline: '🟩🟨🔥💀⬛⬛', survival: 31.26, score: 4820, maxMult: 6, url: 'https://x.test/games/neon-drift/?seed=DAILY-2026-11-21&beat=4820', revived: true });
  assert.match(text, /^NEON DRIFT .+ DAILY-2026-11-21\n🟩🟨🔥💀⬛⬛\n⏱ 31\.3s {2}★ 4,820 {2}✖6 haul\n♻️ revived\nBeat my run: https:/);
  assert.equal(ND.sanitizeSeed('<script>'), null);
  assert.deepEqual(plain(ND.parseLaunchParams('?seed=abc&beat=12')), { seed: 'ABC', beat: 12, debug: false });
});
