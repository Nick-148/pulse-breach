# PLAN: Seedfall Arcade (Pulse Breach, Neon Drift, …)

Status legend: ✅ done · 🟡 in progress · ⬜ not started · ⛔ blocked

## Milestone 1: Pulse Breach, playable single file (2026-11-21) ✅

- ✅ Single-file game, fixed 120 Hz step, six waves + Overdrive, juice, daily/challenge/practice seeds
- ✅ Share card, hangar (3 upgrades × 3 tiers, palettes), AdManager (simulated + SDK adapters)
- ✅ Portrait rotation, unit + e2e tests, CI, ADRs 0001–0006

## Milestone 2: Arcade platform (2026-11-21, `feat/arcade-platform`) ✅ code complete, ⛔ not deployed

- ✅ Repo restructured: `games/<slug>/index.html` cartridges + `shared/` + `portal/` + `server/` (ADR 0007)
- ✅ ArcadeSDK bridge (`sdk/arcade-sdk.js`) + theater host; standalone games untouched (6 bridge tests)
- ✅ Portal: home (featured daily game with 2x credits, quests, trending ticker, category filters), theater
  per game (iframe, leaderboard tabs, challenge-a-friend card, 728×90 / 320×50 slots outside the frame,
  SEO copy + JSON-LD), store, profile & wallet dialog, privacy/terms drafts, 404, sitemap, OG images
- ✅ One site-wide CSP with no hashes (`script-src 'self'`): hosted cartridges are externalised at build
- ✅ API on Pages Functions + D1 (ADR 0008): guest-first accounts with username + Arcade Key (ADR 0009),
  signed run tokens + plausibility checks + rate limits (ADR 0010), daily / all-time / friends boards,
  ghosts, ledger wallet with SQL-enforced caps, daily quests, login streaks, guest merge, cloud saves,
  friends by code, Stripe Checkout + verified webhooks behind `paymentProvider()` (ADR 0011)
- ✅ Pulse Breach on the SDK: hosted mode, run tokens, score submit, ghost recording + rendering, VIP/arcade
  ads, equipped trails, cloud save
- ✅ Neon Drift: Salvage Run (new one-button tether/slingshot game) with the full cartridge contract
- ✅ Tests: 87 unit (API end to end on SQLite, shared rules, SDK, both engines + balance bots);
  e2e rewritten for portal + both games (runs in CI)
- ⛔ Deploy (B1), D1 + `RUN_SECRET` (B9)

## Milestone 3: Launch

- ⛔ Cloudflare project, D1, secrets, first deploy (B1, B9): `docs/runbooks/deploy.md`
- ⛔ Domain + `SITE_URL` (B2), brand name (B10)
- ⛔ Legal review of privacy/terms, COPPA/GDPR-K stance, refund policy (B11) before accounts/store go public
- ⬜ Investigate local Playwright hang on macOS (newer `@playwright/test`, or stop the Android emulator)
- ⬜ Admin tools: rename/remove abusive usernames from a page instead of SQL (runbook has the SQL for now)
- ⬜ Balance pass with real players (death-time histograms per segment; re-tune at UTC midnight)

## Milestone 4: Growth & monetization

- ⛔ Real ad network (B3) + consent management for EU/UK (B4); wire into `portal/assets/js/ads.mjs`
- ⛔ Stripe live mode (B6); Google sign-in (B7); email magic link (B8)
- ⬜ Weekly quests and a weekly leaderboard (same tables, `board = 'W:YYYY-Www'`)
- ⬜ Server-side replay verification: record inputs, re-simulate the deterministic engine in a Worker (ADR 0010)
- ⬜ Portal builds for Poki / CrazyGames from `build/standalone/` (ADR 0003)
- ⬜ More cartridges (Logic & Puzzle category is empty): use `.claude/skills/add-game`
- ⬜ Rename the GitHub repo to match the brand once B10 is decided

## Blockers

| ID | What | Why it blocks | Who unblocks | Since | Stub / workaround |
| -- | ---- | ------------- | ------------ | ----- | ----------------- |
| B1 | Cloudflare login / Pages project | Publishing needs the founder's account | Founder | 2026-11-21 | `npm run deploy` + runbook ready; local `npm run dev` runs everything |
| B2 | Domain (`.io` suggested) | Canonical/OG URLs, brand | Founder | 2026-11-21 | `SITE_URL` env var; defaults to `seedfall-arcade.pages.dev` |
| B3 | Ad network account (AdSense H5 Games, Poki, CrazyGames) | Real ad revenue | Founder (apply) | 2026-11-21 | `HostAds` simulated mode + SDK adapters with the real contract |
| B4 | Consent management (EU/UK) | Required before personalised ads | Founder decision | 2026-11-21 | No ad SDK loaded, so no consent needed yet |
| B5 | Remote changed from GitLab to GitHub `Nick-148/pulse-breach` | n/a | Founder (confirmed) | 2026-11-21 | n/a |
| B6 | Stripe account + keys + webhook | Real purchases | Founder | 2026-11-21 | `paymentProvider()` → `disabled` in prod ("coming soon"), `simulated` in dev |
| B7 | Google OAuth client | Google sign-in | Founder | 2026-11-21 | `AUTH_PROVIDERS.google` reports disabled; username + Arcade Key works |
| B8 | Email provider for magic links (stores emails = PII) | Email sign-in / key recovery | Founder decision | 2026-11-21 | Provider stub returns 501; no emails collected |
| B9 | D1 database + `RUN_SECRET` secret | Accounts, leaderboards, wallet online | Founder (runbook §1) | 2026-11-21 | Without them the site runs guest-only and says so |
| B10 | Platform brand name ("Seedfall Arcade" is provisional) | Store listing, domain, legal pages | Founder | 2026-11-21 | One constant: `shared/site.mjs` |
| B11 | Legal review (privacy, terms, COPPA/GDPR-K, refunds) | Accounts and payments for an audience that includes kids | Founder + counsel | 2026-11-21 | Pages marked "Draft"; store disabled in prod until B6 |
