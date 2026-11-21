# PLAN: Pulse Breach: Daily Run

Status legend: ✅ done · 🟡 in progress · ⬜ not started · ⛔ blocked

## Milestone 1: Playable, shippable single file (2026-11-21) ✅

- ✅ Single-file game `src/index.html`, zero runtime dependencies
- ✅ Fixed 120 Hz timestep, dt clamp 0.05 s, 60/120/144 Hz determinism tests
- ✅ Six 10-second waves + Overdrive (debris, sweeping lasers w/ 1.2 s telegraph, hunter drones w/ baiting,
  pulse rings, gravity wells, golden cores, crossfire, meteor swarms, core meltdown shrapnel)
- ✅ Juice: hitstop (30 ms graze / dash-through), particles, popups `+100 x4`, shake, flash, graze bonus
- ✅ Seeds: Daily (UTC), Friend Challenge `?seed=` (+ optional `&beat=`), Practice (random)
- ✅ Daily best / streak / attempt # in `localStorage` (`pulse_breach_v1_*`)
- ✅ Share card: 6-block emoji timeline, stats, seed, challenge URL, clipboard + `navigator.share`, "Copied!" toast
- ✅ Hangar: 3 upgrades × 3 tiers (magnet, dash cooldown, Aegis), 4 unlockable hull palettes
- ✅ AdManager: banner slot outside canvas, 3 rewarded placements, Simulated / SDK Hooks toggle,
  Poki / CrazyGames / H5 `adBreak` adapters + stub
- ✅ Portrait mobile: view rotates 90° instead of shrinking; touch drag + double-tap + DASH button
- ✅ Cloudflare Pages build: `dist/` + `_headers` (hash-pinned CSP, HSTS, nosniff, Permissions-Policy)
- ✅ Unit tests (node:test, 33)
- 🟡 E2E suite written (`tests/e2e/game.spec.mjs`); runner hangs at startup on the founder's Mac. Next: run it in
  CI (GitHub Actions, ubuntu) or try Node 20 / a newer `@playwright/test`, then fix any failing specs
- ✅ AGENTS.md, skills, ADRs, runbook

## Milestone 2: Launch (next)

- ⛔ Deploy to Cloudflare Pages (see Blockers B1)
- ⛔ Custom domain `pulsebreach.io` (or alternative), see B2; then update `CONFIG.canonicalUrl`
- ⬜ CI: GitHub Actions running `npm run verify` + `npm run test:e2e` on PRs
- ⬜ ESLint (flat config + `eslint-plugin-html`) for the inline script
- ⬜ Hide the Ad Mode toggle in production builds (e.g. `?debug=1` only) once real ads are live
- ⬜ Open Graph share image (procedurally rendered PNG at build time) for richer link previews
- ⬜ Balance pass with real players (death-time histogram per wave; tune `generateSegment` at UTC midnight)

## Milestone 3: Monetization & growth

- ⛔ Real ad network (B3), consent management for EU/UK traffic (B4)
- ⬜ Portal builds (Poki / CrazyGames): build variant that loads the SDK + adjusts CSP/frame-ancestors (ADR 0003)
- ⬜ Optional global daily leaderboard (needs a backend → new ADR; Cloudflare Worker + D1 is the natural fit)
- ⬜ Accessibility: colour-blind safe hazard palette option, remappable keys

## Blockers

| ID | What | Why it blocks | Who unblocks | Since | Stub / workaround |
| -- | ---- | ------------- | ------------ | ----- | ----------------- |
| B1 | Cloudflare login for `wrangler pages deploy` (or connect the GitHub repo in the Pages dashboard) | Publishing needs the founder's Cloudflare account | Founder | 2026-11-21 | `dist/` + `_headers` ready; `docs/runbooks/deploy.md` has both paths |
| B2 | Domain purchase (`pulsebreach.io` suggested; check availability) | Canonical share URLs + brand | Founder | 2026-11-21 | Share links use the current origin (`*.pages.dev` works) |
| B3 | Ad network account/approval (AdSense H5 Games Ads, Poki, or CrazyGames) | Real revenue | Founder (apply) | 2026-11-21 | `AdManager` Simulated mode + SDK-hook stub with the real contract |
| B4 | Consent management platform for personalised ads (EU/UK) | Legal requirement before serving personalised ads | Founder decision | 2026-11-21 | No ad SDK is loaded, so no consent needed yet |
| B5 | Original "push to GitLab" ask replaced by GitHub `Nick-148/pulse-breach` | n/a | Founder (confirmed in chat) | 2026-11-21 | n/a |
