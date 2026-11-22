---
name: add-game
description: Build and register a new single-file game ("cartridge") for the arcade so it inherits leaderboards, ghosts, challenge links, ads and wallet through ArcadeSDK. Use when asked to make, add, or port a game.
---

# Add a game

The contract is **AGENTS.md → Game Cartridge Spec**. Read it first; this is the checklist.

1. **Design** (write 5 lines in the PR description): core verb, one-sentence fantasy, how a 10 s segment is
   generated from the seed, what kills you, what scores. Must be an original game (genre mechanics are fine;
   no copying a specific existing game's name, art, levels or characters).
2. **Scaffold** `games/<slug>/index.html` from `games/neon-drift/index.html`: keep sections 1–8 (config/PRNG,
   audio, ads, engine, renderer, input, UI, app), rename the storage prefix to `<slug_underscored>_v1_`,
   the global (`globalThis.<Name>`), `rngFor` namespace string, and the brand.
3. **Engine first**, DOM-free: `update(dt, input)` with the fixed step, `results()`, `trace` at 10 Hz,
   `revive()` once, `end()`. `generateSegment(seed, k)` must use only its own RNG stream.
4. **Platform hooks**: copy `connectPlatform`, `syncCloudSave`, `platformNote`, the `submitScore` call and
   `shareText` from Neon Drift; call `sdk.init('<slug>')`.
5. **Register** in `shared/games.mjs` (all fields; see existing entries). Start `maxScore` generous, then set
   it to ~5–7x the best bot points-per-second you observe. Pick `pointsPerCredit` so a decent run earns
   30–60 credits.
6. **Tests**: copy `tests/unit/neon-drift.test.mjs` (determinism at 60/120/144 Hz, mechanics, persistence,
   share text, plausibility vs `checkPlausibility`, balance bot with a recorded baseline) and
   `tests/e2e/neon-drift.spec.mjs` (standalone + hosted).
7. Optional: OG art function in `scripts/og.mjs`, 1–3 quests in `shared/quests.mjs`, a new category in
   `CATEGORIES` (the home page shows "coming soon" for empty ones automatically).
8. `npm run verify` (the check script enforces the file rules), look at `/games/<slug>/` with `npm run dev`
   (desktop + a portrait phone viewport), then follow the pre-commit-review skill.
