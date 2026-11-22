---
name: pre-commit-review
description: Mandatory self code review before every commit or push (games, portal, SDK, API): correctness, determinism, security/CSP, tests, docs. Use before committing or pushing any change.
---

# Pre-commit review

Run this every time, even for "tiny" changes. Fix findings before committing.

1. **Gates**: `npm run verify` and `npm run test:e2e` are green. Paste failures, don't hand-wave them.
2. **Read the diff** (`git diff --staged`) top to bottom as a reviewer, not the author.
3. **Correctness**
   - State transitions: can any screen/button fire twice (double click, ad finishing late, timers left running)?
     Every async ad flow must re-check `this.state` after `await`.
   - Timers/intervals created via `App.later` or tracked in `this.timers`, and cleared on transitions.
   - Edge cases: empty/corrupt storage, date rollover at UTC midnight, mobile portrait, reduced motion.
4. **Determinism**: did anything that affects spawns change? (`generateSegment`, `CONFIG` gameplay values,
   `STEP`, world size, consumption order of `rng`). If yes: is it intentional, is `VERSION` bumped, and is the
   UTC-midnight deploy note in PROGRESS.md? `Math.random` must not leak into simulation.
5. **Security**
   - URL/storage data reaches the DOM only via `textContent` / `h()`; `npm run check` passes (no sinks).
   - No new external origins. If any: ADR + `buildCsp` update + e2e still CSP-clean.
   - New `localStorage` fields are sanitised in `sanitize*` with clamps.
6. **API / platform** (if `server/`, `shared/`, `portal/` or `sdk/` changed)
   - Every new endpoint: input validated, auth checked (`requirePlayer`), write paths rate-limited, SQL bound
     with `?`, money/credits only through ledger statements with caps or refs, errors as `HttpError` codes.
   - Schema change = new numbered file in `migrations/` (additive), never an edit to an applied migration.
   - New SDK method: documented fallback, host handler validates params, bridge test updated.
   - Anything a guest can do must still work with the API down (status 0) and with storage blocked.
7. **Tests**: new logic has unit tests; fixed bugs have a regression test.
8. **Performance**: no per-frame allocations in hot loops beyond what exists; DOM writes only on change.
9. **Docs**: PLAN.md statuses, PROGRESS.md entry, ADR for significant decisions, AGENTS.md if a rule changed.
10. **Commit**: conventional message (`feat:`, `fix:`, `docs:`, `test:`, `chore:`), no `dist/`, no `node_modules/`.
