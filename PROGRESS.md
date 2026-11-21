# PROGRESS log

Newest first. One dated entry per working session.

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
- Review fix: keyboard lookup uses `Object.hasOwn` instead of `in` (prototype keys).
- Docs: AGENTS.md, PLAN.md, ADRs 0001–0006, deploy runbook, 5 skills.
- Blocked (documented in PLAN.md): Cloudflare login (B1), domain (B2), ad network (B3), consent (B4).
- Remote: founder supplied `https://github.com/Nick-148/pulse-breach.git` mid-session (instead of GitLab).
