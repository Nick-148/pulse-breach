// Balance guard: a deliberately simple evasive bot must clear the warm-up waves on
// every sampled seed. If a generation change makes early waves unwinnable (or makes
// some seeds far harder than others), this fails before players see it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGame } from '../helpers/load-game.mjs';

const PB = loadGame();
const loadout = PB.loadoutFrom(PB.defaultProfile());

function botInput(e) {
  const p = e.player;
  let fx = (PB.W / 2 - p.x) * 0.002;
  let fy = (PB.H / 2 - p.y) * 0.002;
  let danger = false;
  for (const h of e.hazards) {
    if (h.kind === 'laser') {
      const a = h.age < h.warn ? h.angle : e.laserAngle(h);
      const d = (p.x - h.x) * Math.sin(a) - (p.y - h.y) * Math.cos(a);
      const gap = Math.abs(d) - h.width / 2;
      const s = Math.sign(d) || 1;
      if (gap < 90) { fx += Math.sin(a) * s * (90 - gap) * 0.05; fy -= Math.cos(a) * s * (90 - gap) * 0.05; }
      if (h.age >= h.warn && gap < 25) danger = true;
      continue;
    }
    if (h.kind === 'ring') {
      if (h.age < h.warn) continue;
      const d = Math.hypot(p.x - h.x, p.y - h.y) || 1;
      const gap = Math.abs(d - h.radius);
      const s = d > h.radius ? 1 : -1;
      if (gap < 60) { fx += ((p.x - h.x) / d) * s * 2; fy += ((p.y - h.y) / d) * s * 2; }
      if (gap < 22) danger = true;
      continue;
    }
    if (h.kind === 'burst') {
      const d = Math.hypot(p.x - h.x, p.y - h.y) || 1;
      if (d < 200) { fx += ((p.x - h.x) / d) * 2; fy += ((p.y - h.y) / d) * 2; }
      continue;
    }
    const hx = h.x + (h.vx || 0) * 0.25;
    const hy = h.y + (h.vy || 0) * 0.25;
    const dx = p.x - hx;
    const dy = p.y - hy;
    const d = Math.hypot(dx, dy) || 1;
    const r = (h.kind === 'well' ? h.coreR + 60 : h.r) + 130;
    if (d < r) { const w = (r - d) / r; fx += (dx / d) * w * 3; fy += (dy / d) * w * 3; }
    if (d - (h.r || 0) < 30) danger = true;
  }
  const m = Math.hypot(fx, fy) || 1;
  return { moveX: fx / Math.max(m, 0.3), moveY: fy / Math.max(m, 0.3), dash: danger };
}

function survive(seed) {
  const e = new PB.GameEngine({ seed, loadout });
  for (let i = 0; i < 120 * 60 && e.state === 'running'; i++) e.update(1 / 60, botInput(e));
  return e.results().survival;
}

const SEEDS = ['DAILY-2026-11-21', 'DAILY-2026-11-22', 'DAILY-2026-11-23', 'ABC123', 'P-XYZ234', 'DAILY-2027-01-01'];

test('a simple evasive bot clears the first two waves on every sampled seed', () => {
  const times = SEEDS.map(survive);
  for (const [i, t] of times.entries()) assert.ok(t >= 20, `${SEEDS[i]} died at ${t.toFixed(1)}s`);
  const spread = Math.max(...times) - Math.min(...times);
  assert.ok(spread < 25, `seed difficulty spread too wide: ${times.map((t) => t.toFixed(1)).join(', ')}`);
});
