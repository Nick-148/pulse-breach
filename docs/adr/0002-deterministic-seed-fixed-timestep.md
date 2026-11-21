# ADR 0002: Deterministic seeds and a fixed 120 Hz simulation

- Status: accepted
- Date: 2026-11-21

## Context

The viral loop ("beat my run") only works if every player sees the same hazards for a seed, on any device
and refresh rate. Variable-dt simulation drifts between 60 Hz and 120 Hz displays.

## Decision

- PRNG: `mulberry32`; seed strings hashed with FNV-1a + murmur3 finaliser (`hashString`).
- Spawns are a pure function of `(seed, waveIndex)`: `generateSegment` builds each 10 s chunk from its own stream
  `rngFor(seed, 'wave', k)`. Overdrive chunks are generated lazily the same way.
- The engine advances in fixed `STEP = 1/120 s` ticks from an accumulator; frame dt is clamped to 0.05 s.
  Sim time is `tick * STEP` (integer-derived, no float drift).
- Player-dependent behaviour (drones homing, baiting) is deterministic given the same inputs, but spawn
  *schedules* never depend on the player.
- Cosmetic randomness (particles, stars, engine flicker) uses `Math.random` and never touches simulation state.
- Hitstop pauses the accumulator rather than stretching time, so it can't desync waves.

## Consequences

- Unit tests assert identical outcomes at 60/120/144 Hz and identical schedules per seed.
- Any change to generation, gameplay constants, `STEP` or world size changes every existing seed: ship it at
  UTC midnight and bump `VERSION` (see AGENTS.md rule 3).
