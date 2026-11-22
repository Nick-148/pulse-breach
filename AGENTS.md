# AGENTS.md: how to work on this repo

Guidelines for any AI agent or human contributing to **Seedfall Arcade** (provisional brand, PLAN.md B10).
Read this first, then `PLAN.md` (what's next, blockers), `docs/SPEC.md` (briefs + clarifications) and the ADRs
in `docs/adr/` (why things are the way they are).

## Project in one paragraph

A zero-upfront-cost web arcade: a static **portal shell** (home, one theater page per game, store, profile)
hosts **single-file HTML5 Canvas games ("cartridges")** in a same-origin iframe. Games talk to the platform
only through **`window.ArcadeSDK`**, a postMessage bridge injected by the build, and still run 100% standalone
without it. Everyone plays the same **daily seed**; finished runs get **signed run tokens**, plausibility checks,
leaderboards (daily / all-time / friends), **ghost replays** and **challenge links** (`?seed=&beat=&ghost=`).
Players start as **guests** (localStorage) and can create a no-email account (username + Arcade Key) to claim
spots and sync. Economy: Arcade Credits, Gems, VIP pass, cross-game trails, daily quests and login streaks,
all server-authoritative. Hosting: **Cloudflare Pages + Pages Functions + D1** (one vendor, free tier).
The founder works ~10 hrs/week, so **operational simplicity beats cleverness**.

## Map

| Path | What lives there |
| ---- | ---------------- |
| `games/<slug>/index.html` | **Cartridges.** One self-contained file per game (see Game Cartridge Spec). |
| `shared/` | Pure ES modules used by browser, API and tests: `games.mjs` (registry), `seeds`, `economy`, `quests`, `catalog`, `names`, `validate`, `site`. |
| `sdk/arcade-sdk.js` | The ArcadeSDK bridge (classic script, game side). |
| `portal/assets/` | Portal shell: `css/portal.css`, `js/*.mjs` (platform state, shell, theater host, home, store, ads, bridge host). |
| `scripts/pages.mjs` | Static page templates (home, theater, store, legal, 404). Rendered from the registry at build. |
| `server/` | API (Web-standard code): `router`, `auth`, `play` (runs/scores/boards/ghosts), `account` (wallet/quests/saves/friends), `payments`. |
| `functions/api/[[path]].js` | Cloudflare Pages Function entry → `server/router.mjs`. |
| `migrations/` | D1 SQL migrations (also applied to node:sqlite locally). |
| `scripts/build.mjs` | Builds `dist/` (pages, hosted cartridges, OG images, `_headers`, `_routes.json`, sitemap) and `build/standalone/`. |
| `scripts/check.mjs` | Static guards (cartridge rules, no HTML sinks, purity of `shared/`/`sdk/`, server SQL/fetch rules). |
| `scripts/serve.mjs` | Local server: `dist/` with real `_headers` + `/api` on node:sqlite (`scripts/sqlite-d1.mjs`). |
| `scripts/og.mjs` | Zero-dependency PNG renderer for Open Graph images. |
| `tests/unit/` | `node:test`: API end-to-end on in-memory SQLite, shared rules, SDK bridge, both game engines (+ balance bots). |
| `tests/e2e/` | Playwright (desktop + Pixel 7) against `dist/` + the local API, under the production CSP. |
| `docs/` | `SPEC.md`, `adr/`, `runbooks/deploy.md`. |
| `.claude/skills/` | Repeatable workflows: add-game, add-hazard, deploy, pre-commit-review, handle-blocker, integrate-ad-sdk. |

## Commands

```bash
npm install                       # dev-only deps (Playwright, ESLint); nothing ships to players
npx playwright install chromium   # once, for e2e
npm run dev                       # build + serve http://localhost:4173 (static + API, DB in .data/dev.sqlite)
npm run verify                    # ESLint + static checks + unit tests + build
npm run test:e2e                  # Playwright against dist/ + in-memory API
npm run deploy                    # verify, then wrangler pages deploy (needs Cloudflare login, PLAN B1)
```

`npm run verify` and `npm run test:e2e` must pass before every commit. (Playwright hangs at startup on the
founder's Mac while an Android emulator runs; CI is the source of truth for e2e.)

## Game Cartridge Spec (read this before building a game)

A new game is **one prompt** of work if it follows this contract. Copy the structure of
`games/neon-drift/index.html` (smaller) or `games/pulse-breach/index.html`.

**File**
1. `games/<slug>/index.html`, `<slug>` = `[a-z0-9-]+`. Exactly one `<style>` and one `<script id="game-script">`
   (strict-mode IIFE). No other scripts, no external URLs, fonts, images or audio files: Canvas + Web Audio only.
   Under 160 KiB. No inline `on*=` handlers or `style=""` attributes (set `el.style.x` from JS instead).
2. DOM text only via `textContent`/`createElement`. Never `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`eval`.
3. No network: no `fetch`, XHR, WebSocket, and never `/api`. Everything online goes through the SDK.
4. `localStorage` keys prefixed `<slug_with_underscores>_v1_` (e.g. `neon_drift_v1_`), all reads through a
   try/catch `Store`, every value re-validated (`sanitize*`) on load.

**Gameplay**
5. Fixed timestep `STEP = 1/120`, frame dt clamped to `0.05`, engine class with **no DOM** talking out via
   `onEvent(type, data)`. A run must be identical at 60/120/144 Hz (unit test it).
6. Seeds: `?seed=` sanitized to `[A-Z0-9-]{1,32}`; daily seed `DAILY-YYYY-MM-DD` (UTC); `?beat=` `^\d{1,9}$`.
   Everything that spawns comes from a seeded PRNG, one stream per time segment; `Math.random` is cosmetic only.
7. Fixed world (1280×720 recommended). On portrait screens rotate the view 90° instead of shrinking.
8. Modes: Daily / Challenge (when `?seed=` is present, show "CHALLENGE MODE … TARGET TO BEAT: n") / Practice.
9. End of run: spoiler-free 6-block emoji timeline share card + challenge URL; rewarded revive (once per run).
10. Accessibility: real `<button>`s, ≥44 px touch targets, `aria-live` announcements, keyboard play,
    `prefers-reduced-motion` disables shake/flash. Pause on `visibilitychange`, P/Esc; mute on M.
11. Record the player position at 10 Hz into `engine.trace` (flat `[x, y, …]`, ≤ 6000 numbers) for ghosts.
12. Expose `globalThis.<GameName>` with pure functions for unit tests; `?debug=1` adds read-only e2e hooks.

**Platform hooks** (all optional; feature-detect `const sdk = globalThis.ArcadeSDK || null`)
- At boot: `sdk.init('<slug>')` → `{player:{signedIn,name,vip}, trail:{colors}|null, challenge:{seed,beat,ghost}, dailySeed, featured, adFree, leaderboards, offline}`.
  When hosted, add `html.hosted` (hide your own brand/banner), validate `trail.colors` as `#rrggbb` before use.
- `sdk.on('pause', fn)` (portal dialog opened) and `sdk.on('trail', fn)`.
- Run start: `sdk.runStarted({seed, mode})`. Run end, once: `sdk.submitScore({score, survivalTime, seed, metadata, ghostData: engine.trace})`
  → `{accepted, reason, rank, credits, ghostId, signedIn}`; show `rank` / "sign in to claim" on your game-over screen.
- Rewarded ads: `sdk.ads.showRewarded(placement)` → `{granted, reason}` (VIP is granted instantly).
- Share: `sdk.share.challengeUrl({seed, score, ghost})` (synchronous, use inside the click handler).
- Ghosts: if `init().challenge.ghost`, `sdk.ghost.get(id)` → `{seed, frames, hz, name}`; draw it only when `seed` matches.
- Optional: `sdk.save.get()/set(data)` (cloud save, signed-in only), `sdk.wallet.*`, `sdk.gameplay(active)`.
- Every SDK call resolves (never rejects) with a fallback; never block gameplay on it.

**Registration** (same change)
13. Add an entry to `shared/games.mjs`: title, subtitle, categories, accent colors, blurb, SEO description,
    controls, strategy, `dailySeed`, `seedPattern`, `world`, and `scoring` (`maxSurvivalMs`, a generous
    `maxScore(seconds)` ceiling from bot/real data, `pointsPerCredit`, `maxRunCredits`).
14. Optional: OG art in `scripts/og.mjs` (`ART[slug]`), quests in `shared/quests.mjs`.
15. Tests: `tests/unit/<slug>.test.mjs` (determinism, mechanics, persistence, a balance bot, plausibility vs
    `shared/validate.mjs`) and an e2e spec (standalone + hosted). Step-by-step: `.claude/skills/add-game/SKILL.md`.

## Non-negotiable rules

### Architecture
1. **Cartridges stay standalone.** The build only injects the SDK into the hosted copy (`/games/<slug>/play/`);
   `build/standalone/<slug>.html` is the untouched file for itch.io/Poki/CrazyGames.
2. **Determinism is the product.** Changing generation, gameplay `CONFIG`, `STEP` or world size changes every
   seed: ship at UTC midnight, bump the game's `VERSION`, note it in `PROGRESS.md`.
3. **The server is the authority** for scores, balances, prices, quests and purchases (ADR 0010/0011). Client
   numbers (guest wallet, game-reported scores) are untrusted: validate, cap, or recompute.
4. **Everything degrades.** API down or D1 missing → guest mode; SDK silent → standalone game. No page may break.
5. **One vendor.** Cloudflare Pages/Functions/D1 only; a new service needs an ADR and a blocker entry.

### Security
1. URL/storage/API data never reaches HTML parsing. Portal DOM is built with `h()`/`textContent` (`portal/assets/js/dom.mjs`).
2. One site-wide CSP (`scripts/lib.mjs#buildCsp`): `default-src 'none'`, `script-src 'self'`, `style-src 'self'`,
   `connect-src 'self'`, `frame-ancestors 'self'`. No inline scripts (JSON-LD data blocks only), styles or handlers.
3. API: every state-changing request must be JSON + same `Origin` (CSRF); session cookie `HttpOnly; Secure;
   SameSite=Lax; __Host-`; only hashes of session tokens / Arcade Keys are stored; all SQL uses bound `?`
   parameters (`check.mjs` rejects interpolation other than ALL_CAPS constant fragments).
4. Rate-limit every write path (`ctx.limit`). IPs only as daily-rotating salted hashes. No PII, no analytics
   without an ADR covering consent.
5. The SDK bridge checks `event.origin` and `event.source` on both sides; host handlers validate params.
6. Secrets (`RUN_SECRET`, `STRIPE_*`) live in Cloudflare env only, never in git. `.dev.vars`/`.data/` are ignored.
7. Money: prices come from `shared/catalog.mjs`; grants only from verified webhooks; fulfilment is idempotent.

### Code style
- Vanilla ES2022, no runtime npm dependencies, `'use strict'` in classic scripts. Validate unknown data explicitly.
- Comment *why*, not *what*. Small functions named for intent. Match surrounding style.
- Pure logic lives in `shared/` (portable to browser, Workers, Node) and is unit tested without a DOM.
- Accessibility and performance rules from the cartridge spec apply to the portal too (no per-frame DOM writes).

### Testing
- New logic → unit test in the same change. Bugs → regression test first.
- API behaviour is tested end to end through `server/router.mjs` on in-memory SQLite (`tests/helpers/api.mjs`).
- Balance bots (`tests/unit/balance.test.mjs`, `tests/unit/neon-drift.test.mjs`): if a change makes them fail,
  re-tune deliberately and record it in PROGRESS.md; never loosen thresholds silently.
- E2E covers: home, theater + SDK, guest → sign-up claim, ghost challenge, store, hostile params, 404/CSRF,
  mobile portrait, and each game standalone.

## Workflow
1. Check `PLAN.md` for the milestone and blockers.
2. Branch (`feat/…`, `fix/…`, `docs/…`).
3. `npm run verify && npm run test:e2e`.
4. **Review before committing**: `.claude/skills/pre-commit-review/SKILL.md`.
5. Significant decisions → new ADR (`docs/adr/NNNN-title.md`).
6. Dated entry in `PROGRESS.md`; update `PLAN.md`.
7. Conventional commits; push to `origin` (GitHub); open a PR (CI runs verify + e2e).

## When blocked
Never stall on an external dependency (accounts, keys, approvals, founder decisions): **document it** in
`PLAN.md → Blockers`, **stub it behind an interface** (models: `AdManager` adapters, `AUTH_PROVIDERS`,
`paymentProvider()`), **move on**. Full procedure: `.claude/skills/handle-blocker/SKILL.md`, ADR 0005.
