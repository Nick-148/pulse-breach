# PROGRESS log

Newest first. One dated entry per working session.

## 2026-11-21 (evening session, from 20:15 ET): arcade platform

Brief: turn Pulse Breach into a zero-upfront-cost web arcade (portal + ArcadeSDK + accounts + leaderboards +
wallet + store) and add a second game, Neon Drift. Work happened on `feat/arcade-platform`.

- Restructured the repo: `games/<slug>/index.html` cartridges, `shared/` pure modules, `portal/`, `server/`,
  `functions/`, `migrations/`. Decisions in ADRs 0007–0011.
- **Backend** (Pages Functions + D1): auth (username + server-generated Arcade Key, OAuth/magic-link stubs),
  signed run tokens, plausibility checks (survival ≤ wall clock, per-game score ceilings, ghost bounds),
  daily/all-time/friends boards (all-time counts daily seeds only), ghosts, ledger wallet (balances are
  `SUM(delta)`, caps enforced inside single `INSERT … SELECT` statements), quests, streaks, guest merge,
  cloud saves, friends, Stripe Checkout + signed webhooks. Tested end to end on node:sqlite through the real
  router (`scripts/sqlite-d1.mjs`), so no Wrangler is needed locally.
- Found and fixed while testing: featured-game credits were eating into the normal daily cap; split into two
  buckets (`run`, `run_featured`). Stripe fulfilment now keys orders by our own id created *before* calling
  Stripe, and records webhook events only after a successful fulfilment (retries stay safe).
- **ArcadeSDK** + theater host: postMessage RPC with origin/source checks both ways; every call resolves with
  a fallback; the SDK only exists when framed by the same-origin theater.
- **Portal**: home, theater, store, profile dialog, legal drafts, 404, OG images (zero-dependency PNG
  renderer), sitemap, JSON-LD. One site-wide CSP without hashes: the build externalises each hosted
  cartridge's inline script/style; standalone copies go to `build/standalone/` untouched.
- **Pulse Breach 1.1.0**: hosted mode, run tokens, score submission, 10 Hz ghost trace + ghost rendering,
  arcade ads (VIP instant), equipped trails (validated hex colors), cloud save with `savedAt` last-write-wins.
  Generation unchanged, so seeds are unchanged.
- **Neon Drift: Salvage Run 1.0.0** (new, 85 KiB): one-button tether/slingshot. Balance tuned with a
  heuristic bot: holding near a wall used to chain bounces (−12 fuel each, death in ~1 s), so I added a
  0.35 s post-bounce stun, cut the bounce cost to 8, fuel drain 5→4.2/s, crate fuel 13→16, and mines now arm
  only once the skiff is clear of them. Bot baseline: mean 30.8 s, min 11.5 s over 8 seeds (balance test
  thresholds: every seed ≥ 8 s, mean ≥ 22 s). Quest targets set from this (35 s / 60 s / 3,000 pts).
- Verified in the browser preview under the production CSP: home, store, theater for both games, guest run
  → pending claim → account creation → run on the daily board, ghost challenge link → "racing <name>'s ghost".
- Tests: 87 unit tests green; ESLint + static guards green. Playwright still hangs at startup locally
  (Android emulator running), so e2e (rewritten: 3 specs, portal + both games) runs in GitHub Actions.
- Not done (blocked): deploy, D1, secrets, Stripe, OAuth, domain, brand, legal review (PLAN.md B1–B11).

## 2026-11-21 (overnight session, 02:50–04:00 ET)

- Asked the founder 4 kickoff questions (location, remote, fairness, deploy), recorded in `docs/SPEC.md → Clarifications`.
- Built `src/index.html`: full game (engine, renderer, audio synth, AdManager, UI, progression) in one file.
- Determinism verified: an idle run ends at the same tick/score/timeline at 60, 120 and 144 Hz.
- Build pipeline: `scripts/build.mjs` emits `dist/_headers` with a hash-pinned CSP; `scripts/serve.mjs`
  applies the same headers locally so CSP problems surface before deploy. Found and fixed a stale-header
  bug in the dev server (it cached `_headers` at startup).
- Fixed: `[hidden]` was overridden by `.btn { display: inline-flex }` (Challenge tab showed without a seed).
- Tests: 33 unit tests (seed, engine, progression, ads), all green. Playwright e2e suite written (10 specs,
  desktop + mobile) but **not yet run green**: the Playwright 1.49.1 runner hangs at startup on this machine
  (even `playwright test --list`; Node 24, an Android emulator was running). Core flows were verified by hand
  in a browser under the production CSP: load, run, breach → revive offer → decline → game over, share text.
  Follow-up in PLAN.md.
- Added GitHub Actions CI (Node 22; Node 20's `node --test` lacks glob support). First green run:
  verify ✓, e2e **18 passed / 2 intentionally skipped** (desktop + Pixel 7) under the production CSP.
- Pushed to `github.com/Nick-148/pulse-breach` (`main`).
- Added ESLint 9 + `eslint-plugin-html` (recommended + eqeqeq/prefer-const/no-implicit-globals); the game script
  lints clean. Wired into `npm run verify` (and therefore CI).
- Supply chain: pinned workflow actions to commit SHAs; added Dependabot for npm + GitHub Actions.
- Balance baseline: a crude evasive bot (no upgrades) survives 35–43 s across 8 seeds, dying in wave 4–5
  (rings/wells, crossfire). Early waves are fair and seed difficulty is consistent. Kept as
  `tests/unit/balance.test.mjs` (≥ 20 s on every sampled seed, spread < 25 s).
- Review fixes: engine input is clamped to finite values (a 0-size stage could otherwise yield NaN drag deltas
  and corrupt the ship position, now covered by a regression test); renderer scale is floored; tabs re-sync
  progression on the `storage` event so two open tabs no longer overwrite each other's scrap/upgrades.
- Render interpolation for the ship (`GameEngine.renderPos`): no judder on 144 Hz+ screens where some frames
  run zero 120 Hz steps. Render-only, so determinism is unchanged (tests still pass at 60/120/144 Hz).
- Review fix: keyboard lookup uses `Object.hasOwn` instead of `in` (prototype keys).
- Docs: AGENTS.md, PLAN.md, ADRs 0001–0006, deploy runbook, 5 skills.
- Blocked (documented in PLAN.md): Cloudflare login (B1), domain (B2), ad network (B3), consent (B4).
- Remote: founder supplied `https://github.com/Nick-148/pulse-breach.git` mid-session (instead of GitLab).
