---
name: add-hazard
description: Add a new hazard, pickup, or wave pattern to Pulse Breach while keeping seeds deterministic and fair. Use when asked to add an enemy, obstacle, pickup, or change a wave.
---

# Add a hazard / wave pattern

1. **Generation** (`generateSegment`): add a creator that draws *all* random parameters from the wave's `rng`
   and pushes `{ t, type, ...params }`. Keep events inside `[t0, t1 - 0.4)`. Add it only to the waves where it
   belongs. ⚠ Any change here alters every seed: ship at UTC midnight and bump `VERSION`.
2. **Engine** (`GameEngine`):
   - `spawn(e)`: map the event to a hazard object via `addHazard` (gets `id/age/dead/grazed/phased`).
   - `updateHazards`: movement/lifetime; set `h.dead = true` to remove (arrays are compacted in place).
   - `hazardGap`: distance from a point to the lethal surface, `Infinity` while telegraphing. This single
     function powers hits, grazes and dash-through, so you get juice for free.
   - Telegraph anything that can kill from a non-edge position (≥ 0.6 s; lasers use 1.2 s).
   - Emit `onEvent('spawn', …)` is automatic; add custom events if FX/audio need them.
3. **Renderer**: a `drawX(h)` method + a `case` in `drawHazards`. Danger colours are red/orange/magenta/purple;
   never use the player's theme colours for hazards. Use `Renderer.text()` for any text.
4. **Audio** (optional): a `case` in `AudioSynth.play`, wired from `App.onEngineEvent`.
5. **Tests**: extend `tests/unit/engine.test.mjs` (appears in the intended wave; collision via `hazardGap`;
   determinism tests still pass).
6. Playtest at `npm run dev` on desktop and a portrait mobile viewport.
