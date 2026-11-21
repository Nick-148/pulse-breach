# AGENTS.md: how to work on this repo

Guidelines for any AI agent or human contributing to **Pulse Breach: Daily Run**. Read this first,
then `PLAN.md` (what's next), `docs/SPEC.md` (the product brief + clarifications) and the ADRs in
`docs/adr/` (why things are the way they are).

## Project in one paragraph

A single-file, zero-dependency HTML5 Canvas arcade game (`src/index.html`): a 60-second daily
survival run where every player gets the same seeded hazards, plus endless Overdrive, a share card
for viral challenges, local progression (scrap, upgrades, hull trails) and an `AdManager` with
simulated + SDK-hook rewarded ads. It deploys as static files to **Cloudflare Pages** with a strict
hash-based CSP. There is **no backend**: all state lives in the player's `localStorage`. The
founder works ~10 hrs/week, so **operational simplicity beats cleverness**.

## Map

| Path                         | What lives there                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| `src/index.html`             | **The whole game.** One `<style>`, one `<script id="game-script">`. Ships as-is.   |
| `scripts/build.mjs`          | Copies the game to `dist/` and writes `_headers` with CSP hashes of inline blocks. |
| `scripts/check.mjs`          | Static guards: zero deps, no HTML-string sinks, no inline handlers, size budget.   |
| `scripts/serve.mjs`          | Local static server that applies `dist/_headers` exactly like Pages.               |
| `scripts/lib.mjs`            | Shared helpers (CSP hashing, `_headers` parsing).                                  |
| `eslint.config.mjs`          | ESLint 9 flat config; `eslint-plugin-html` lints the inline game script.          |
| `.github/workflows/ci.yml`   | CI: verify + Playwright e2e (desktop + mobile) on push/PR.                         |
| `tests/unit/`                | `node:test` suites that load the game script in a VM (no DOM, no deps).            |
| `tests/e2e/`                 | Playwright against `dist/` with real headers (desktop + mobile).                   |
| `docs/SPEC.md`               | Original brief + appended clarifications. Source of truth for scope.               |
| `docs/adr/`                  | Architecture Decision Records (`0000-template.md`).                                |
| `docs/runbooks/`             | Deploy + operations.                                                               |
| `.claude/skills/`            | Repeatable workflows (review, blockers, deploy, add a hazard, wire an ad SDK).     |

### Inside `src/index.html`

The script is one strict-mode IIFE with numbered sections. Keep this order:

1. **Config & SeededPRNG**: `CONFIG`, `mulberry32`, `hashString`, `Rng`, seeds, storage, economy, daily, share card, spawn director (`generateSegment`).
2. **AudioSynth**: Web Audio only; unlocked on first gesture; mute + ad ducking.
3. **AdManager**: simulated countdown modal; SDK adapters (Poki → CrazyGames → H5 `adBreak` → stub).
4. **GameEngine**: pure simulation, **no DOM**; fixed 120 Hz step.
5. **Renderer**: Canvas 2D, fixed 1280×720 world, rotates 90° on portrait screens.
6. **Input**: keyboard, relative drag, double-tap/button dash.
7. **UIManager**: DOM screens + HUD via `textContent` / `h()` only.
8. **App**: run lifecycle, persistence, wiring.

`globalThis.PulseBreach` exposes the pure API for tests. `?debug=1` adds e2e hooks (`api.debug`).

## Commands

```bash
npm install                 # once: dev-only deps (Playwright, ESLint); the game itself has none
npx playwright install chromium   # once, for e2e
npm run dev                 # build + serve dist/ on http://localhost:4173 with real headers
npm run verify              # ESLint + static checks + unit tests + build
npm run test:e2e            # Playwright (desktop + mobile) against dist/
npm run deploy              # verify, then wrangler pages deploy (needs Cloudflare login)
```

`npm run verify` and `npm run test:e2e` must pass before every commit.

## Non-negotiable rules

### Product / architecture

1. **Single file, zero runtime dependencies.** No external scripts, fonts, images, audio or CSS.
   Graphics are Canvas primitives; sounds are synthesized. `scripts/check.mjs` enforces this.
2. **Determinism is the product.** Anything that affects *what spawns, where, or when* must come
   from `rngFor(seed, …)` inside `generateSegment`. Cosmetic randomness (particles, stars) uses
   `Math.random` and must never feed the simulation. Each wave has its own RNG stream; never
   consume a shared stream across waves (it would shift every later wave when you edit one).
3. **Changing generation changes every seed.** Any edit to `generateSegment`, `CONFIG` gameplay
   values, `STEP`, or the world size alters existing daily/challenge runs. Ship such changes at
   UTC midnight, record them in `PROGRESS.md`, and bump `VERSION`.
4. **The engine stays DOM-free.** It talks to the outside world only through `onEvent(type, data)`.
5. **Fixed timestep.** Simulate in `STEP = 1/120` s ticks; clamp frame dt with `MAX_FRAME_DT`.

### Security

1. **URL input is untrusted.** `?seed` passes `sanitizeSeed` (whitelist `[A-Z0-9-]{1,32}`);
   `?beat` must be `^\d{1,9}$`. Never render URL/storage data through HTML parsing.
2. **No HTML-string sinks.** No `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`,
   `eval`, `new Function`. Build DOM with `h()` / `textContent`.
3. **CSP stays strict.** `default-src 'none'`, hash-pinned inline script/style, `connect-src 'none'`.
   No inline `style=""` or `on*=` attributes (setting `el.style.*` from JS is fine). Loading any
   third-party origin (e.g. a real ad SDK) requires an ADR + a change in `scripts/lib.mjs#buildCsp`.
4. **Re-validate persisted data on every load** (`sanitizeProfile/Settings/Daily`). Storage can be
   stale, edited, full, or unavailable; every `localStorage` access goes through `Store` (try/catch).
5. **Ads never break the game.** Every SDK call goes through `safeCall` / `withTimeout`;
   `showRewarded` always resolves `{granted, reason}` and never rejects.
6. **No secrets, no PII.** The game has no accounts. Never add analytics that collect personal data
   without an ADR covering consent (EU/UK ads will need a CMP: see `PLAN.md` blockers).

### Code style

- Vanilla ES2022, `'use strict'`, no `any`-style looseness: validate unknown data explicitly.
- Comment *why*, not *what*. Small functions named for intent. Match surrounding style.
- Pure logic (economy, daily, share text, spawn generation) is plain functions that return new
  objects; keep it testable in `tests/unit` without a DOM.
- Accessibility: real `<button>`s, `aria-live` for toasts/announcements, visible focus, 44 px touch
  targets, `prefers-reduced-motion` disables shake/flash.
- Performance: no per-frame DOM writes unless a value changed (`hudCache`); compact arrays in place;
  cap particles (700) and hazards (`MAX_HAZARDS`).

### Testing

- New logic → unit test in the same change. Bugs → regression test first.
- Determinism tests must keep passing (60/120/144 Hz equivalence, same-seed schedule equality).
- `tests/unit/balance.test.mjs` plays every sampled seed with a simple bot; if you make waves harder and it
  fails, re-tune deliberately (and say so in PROGRESS.md) rather than loosening the threshold silently.
- E2E covers the core loop: load under CSP → run → breach → revive/decline → share; hangar; toggles.

## Workflow

1. Check `PLAN.md` for the current milestone and open blockers.
2. Branch (`feat/…`, `fix/…`, `docs/…`).
3. `npm run verify && npm run test:e2e`.
4. **Review before committing**: follow `.claude/skills/pre-commit-review/SKILL.md`.
5. Record significant decisions as a new ADR (`docs/adr/NNNN-title.md`).
6. Append a dated entry to `PROGRESS.md`; update status/checkboxes in `PLAN.md`.
7. Conventional commit (`feat: …`, `fix: …`, `docs: …`) and push to `origin` (GitHub).

## When blocked

Never stall on an external dependency (ad network approval, domain, Cloudflare login, founder decision):

1. **Document it** in `PLAN.md → Blockers` (what, why it blocks, who can unblock, date).
2. **Stub it behind an interface**: the `AdManager` adapter list is the model: a real adapter
   and a stub with the same contract, selected at runtime, never able to break gameplay.
3. **Move on** to the next unblocked task and log it in `PROGRESS.md`.

Full procedure: `.claude/skills/handle-blocker/SKILL.md` and ADR 0005.
