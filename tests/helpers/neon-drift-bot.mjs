// Heuristic Neon Drift bot: release when the straight path intercepts salvage soon and is mine/wall safe;
// when free, tether before walls or mines. Exported for the balance test.
export function makeBot(ND) {
  const { W, H } = ND;
  const firstHit = (s, mines, horizon) => {
    // earliest time the straight line from s (vx,vy) comes within 30px of an armed-or-arming mine
    let t = Infinity;
    for (const m of mines) {
      for (let k = 1; k <= 12; k++) {
        const tt = (horizon * k) / 12;
        const dx = s.x + s.vx * tt - (m.x + m.vx * tt);
        const dy = s.y + s.vy * tt - (m.y + m.vy * tt);
        if (Math.hypot(dx, dy) < 34) { t = Math.min(t, tt); break; }
      }
    }
    return t;
  };
  const wallTime = (s) => {
    const tx = s.vx > 0 ? (W - s.x) / s.vx : s.vx < 0 ? -s.x / s.vx : Infinity;
    const ty = s.vy > 0 ? (H - s.y) / s.vy : s.vy < 0 ? -s.y / s.vy : Infinity;
    return Math.min(tx, ty);
  };
  const interceptTime = (s, salvage, horizon) => {
    let best = Infinity;
    for (const c of salvage) {
      if (ND.CONFIG.salvage.life - c.age < 0.6) continue;
      for (let k = 1; k <= 16; k++) {
        const tt = (horizon * k) / 16;
        if (Math.hypot(s.x + s.vx * tt - (c.x + c.vx * tt), s.y + s.vy * tt - (c.y + c.vy * tt)) < 22) { best = Math.min(best, tt - (c.golden ? 0.5 : 0)); break; }
      }
    }
    return best;
  };
  let orbitT = 0;
  return (e, dt) => {
    const s = e.ship;
    const wt = wallTime(s);
    const mineT = firstHit(s, e.mines, 0.8);
    if (s.tether) {
      orbitT += dt;
      // Look ahead along the orbit: bail out if a mine will cross it in the next 0.6 s.
      const t = s.tether;
      const w = (t.dir * Math.hypot(s.vx, s.vy)) / t.r;
      let orbitMine = false;
      for (let k = 1; k <= 10 && !orbitMine; k++) {
        const tt = 0.06 * k;
        const ox = t.beacon.x + Math.cos(t.angle + w * tt) * t.r;
        const oy = t.beacon.y + Math.sin(t.angle + w * tt) * t.r;
        for (const m of e.mines) if (Math.hypot(ox - (m.x + m.vx * tt), oy - (m.y + m.vy * tt)) < 36) { orbitMine = true; break; }
      }
      if (orbitMine && mineT > 0.5) { orbitT = 0; return false; }
      const it = interceptTime(s, e.salvage, 1.6);
      const safe = wt > Math.min(it, 1.6) + 0.25 && mineT > Math.min(it, 1.6) + 0.1;
      if (it < 1.6 && safe) { orbitT = 0; return false; }
      if (orbitT > 4 && wt > 1.2 && mineT > 0.8) { orbitT = 0; return false; }
      return true;
    }
    orbitT = 0;
    return wt < 0.55 || mineT < 0.45 || (interceptTime(s, e.salvage, 2) === Infinity && wt < 1.2);
  };
}
