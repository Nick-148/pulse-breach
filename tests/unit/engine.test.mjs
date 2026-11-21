import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGame, runIdle } from '../helpers/load-game.mjs';

const PB = loadGame();
const base = PB.loadoutFrom(PB.defaultProfile());
const SEED = 'DAILY-2026-11-21';

test('the same seed produces the same wave schedule', () => {
  for (let k = 0; k < 8; k++) {
    assert.deepEqual(PB.generateSegment(SEED, k), PB.generateSegment(SEED, k));
  }
  assert.notDeepEqual(PB.generateSegment(SEED, 0), PB.generateSegment('OTHER', 0));
});

test('each wave introduces the hazards the design calls for', () => {
  const kinds = (k) => new Set(PB.generateSegment(SEED, k).map((e) => e.type));
  assert.ok(kinds(0).has('debris') && kinds(0).has('shard'));
  assert.ok(kinds(1).has('laser'));
  assert.ok(kinds(2).has('drone'));
  assert.ok(kinds(3).has('ring') && kinds(3).has('well'));
  assert.ok(PB.generateSegment(SEED, 3).some((e) => e.type === 'shard' && e.golden), 'golden cores in wave 4');
  const w5 = PB.generateSegment(SEED, 4);
  assert.ok(w5.filter((e) => e.type === 'laser').length >= 4, 'crossfire lasers');
  assert.ok(kinds(5).has('burst'), 'core meltdown shrapnel');
  const shardRate = (k) => PB.generateSegment(SEED, k).filter((e) => e.type === 'shard').length;
  assert.ok(shardRate(5) >= shardRate(1) * 1.6, 'double shard rate in meltdown');
});

test('every event stays inside its own 10 s chunk and is sorted', () => {
  for (let k = 0; k < 9; k++) {
    const ev = PB.generateSegment(SEED, k);
    for (let i = 0; i < ev.length; i++) {
      assert.ok(ev[i].t >= k * 10 && ev[i].t < (k + 1) * 10, `wave ${k} event at ${ev[i].t}`);
      if (i) assert.ok(ev[i].t >= ev[i - 1].t);
    }
  }
});

test('lasers telegraph for 1.2 s before firing', () => {
  const lasers = PB.generateSegment(SEED, 1).filter((e) => e.type === 'laser');
  assert.ok(lasers.length > 0);
  for (const l of lasers) assert.equal(l.warn, 1.2);
});

test('a run is identical at 60 Hz, 120 Hz and 144 Hz (fixed timestep)', () => {
  const outcome = (dt) => {
    const e = runIdle(new PB.GameEngine({ seed: SEED, loadout: base }), dt);
    return { tick: e.tick, score: e.score, timeline: e.results().timeline };
  };
  const a = outcome(1 / 60);
  assert.deepEqual(outcome(1 / 120), a);
  assert.deepEqual(outcome(1 / 144), a);
  assert.equal(outcome(1 / 30).tick, a.tick, 'clamped large frames still step the same ticks');
});

test('frame dt is clamped so a long stall cannot skip the player through hazards', () => {
  const e = new PB.GameEngine({ seed: SEED, loadout: base });
  const steps = e.update(5, { moveX: 0, moveY: 0 });
  assert.ok(steps <= Math.ceil(0.05 / PB.STEP));
});

test('non-finite input can never corrupt the player position', () => {
  const e = new PB.GameEngine({ seed: SEED, loadout: base });
  e.update(1 / 60, { moveX: NaN, moveY: Infinity, dragging: true, dragDX: NaN, dragDY: -Infinity });
  e.update(1 / 60, { moveX: 0, moveY: 0, dragging: true, dragDX: 0 / 0, dragDY: 5 });
  assert.ok(Number.isFinite(e.player.x) && Number.isFinite(e.player.y));
  assert.ok(Number.isFinite(e.player.tx) && Number.isFinite(e.player.ty));
});

test('Aegis shield absorbs a fatal hit, then the next hit breaches', () => {
  const loadout = PB.loadoutFrom({ ...PB.defaultProfile(), upgrades: { magnet: 0, dash: 0, aegis: 1 } });
  const events = [];
  const e = new PB.GameEngine({ seed: SEED, loadout, onEvent: (t) => events.push(t) });
  e.hit({ kind: 'debris' });
  assert.equal(e.state, 'running');
  assert.equal(e.player.shield, 0);
  assert.ok(e.player.invuln > 0);
  assert.ok(events.includes('shield'));
  e.hit({ kind: 'debris' });
  assert.equal(e.state, 'breach');
});

test('revive resumes at the breach timestamp with 2.5 s invulnerability, once', () => {
  const e = new PB.GameEngine({ seed: SEED, loadout: base });
  runIdle(e, 1 / 60);
  assert.equal(e.state, 'breach');
  const t = e.time;
  assert.equal(e.revive(), true);
  assert.equal(e.state, 'running');
  assert.equal(e.time, t);
  assert.equal(e.player.invuln, PB.CONFIG.revive.invuln);
  runIdle(e, 1 / 60);
  assert.equal(e.revive(), false, 'only one revive per run');
  const res = e.results();
  assert.equal(res.revived, true);
});

test('phase dash grants invulnerability and goes on cooldown', () => {
  const e = new PB.GameEngine({ seed: SEED, loadout: base });
  e.update(1 / 60, { moveX: 1, moveY: 0, dash: true });
  assert.ok(e.player.dashInv > 0);
  assert.ok(e.player.dashCd > 0);
  e.hit = () => assert.fail('must not be hit while phasing');
  // Overlapping hazard during the dash → phase-through bonus instead of a hit.
  e.hazards.push({ kind: 'debris', x: e.player.x, y: e.player.y, vx: 0, vy: 0, r: 20, spin: 0, rot: 0, verts: null, id: 999, age: 0, dead: false, grazed: false, phased: false });
  e.checkCollisions();
  assert.equal(e.stats.phases, 1);
  assert.ok(e.hitstop > 0, 'dash-through triggers hitstop');
});

test('grazing a hazard scores once and triggers a freeze-frame', () => {
  const e = new PB.GameEngine({ seed: SEED, loadout: base });
  const p = e.player;
  e.hazards.push({ kind: 'debris', x: p.x + p.r + 10 + 5, y: p.y, vx: 0, vy: 0, r: 5, spin: 0, rot: 0, verts: null, id: 998, age: 0, dead: false, grazed: false, phased: false });
  e.checkCollisions();
  e.checkCollisions();
  assert.equal(e.stats.grazes, 1);
  assert.ok(e.hitstop > 0);
});

test('drones baited into each other both explode for a bonus', () => {
  const e = new PB.GameEngine({ seed: SEED, loadout: base });
  const drone = (x, id) => ({ kind: 'drone', x, y: 100, vx: 0, vy: 0, r: 13, life: 9, maxSpeed: 0, id, age: 0, dead: false, grazed: false, phased: false });
  e.hazards.push(drone(100, 1), drone(110, 2));
  e.updateHazards(PB.STEP);
  assert.equal(e.hazards.filter((h) => h.kind === 'drone').length, 0);
  assert.equal(e.stats.baits, 1);
});

test('collecting shards builds the combo multiplier', () => {
  const e = new PB.GameEngine({ seed: SEED, loadout: base });
  for (let i = 0; i < 8; i++) e.shards.push({ id: 100 + i, x: e.player.x, y: e.player.y, golden: false, age: 0, dead: false });
  e.updateShards(PB.STEP);
  assert.equal(e.stats.shards, 8);
  assert.equal(e.mult, 3);
  assert.equal(e.maxMult, 3);
});

test('magnet upgrade pulls shards in from range', () => {
  const loadout = PB.loadoutFrom({ ...PB.defaultProfile(), upgrades: { magnet: 3, dash: 0, aegis: 0 } });
  const e = new PB.GameEngine({ seed: SEED, loadout });
  e.shards.push({ id: 1, x: e.player.x + 200, y: e.player.y, golden: false, age: 0, dead: false });
  for (let i = 0; i < 60; i++) e.updateShards(PB.STEP);
  assert.equal(e.stats.shards, 1);
});
