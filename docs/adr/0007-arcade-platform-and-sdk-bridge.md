# ADR 0007: Arcade platform: portal shell, game cartridges, ArcadeSDK bridge

- Status: accepted
- Date: 2026-11-21

## Context

The repo grows from one game into a web arcade that hosts many single-file games (Pulse Breach, Neon Drift,
then more built by Claude sessions). Each game must stay playable standalone (itch.io, Poki, CrazyGames, opened
from disk) and must also inherit platform features when hosted: accounts, leaderboards, a shared wallet,
rewarded ads, challenge links, ghosts. The founder has ~10 hrs/week, so adding a game must be a one-prompt job.

## Decision

- **Cartridges.** A game is one self-contained file at `games/<slug>/index.html` (ADR 0001 rules still apply
  per game) plus an entry in `shared/games.mjs` (title, category, SEO copy, scoring bounds). The cartridge
  never calls the network and never assumes the platform exists.
- **Portal shell.** Static pages generated at build time from `portal/` templates and `shared/games.mjs`:
  home (`/`), one theater page per game (`/games/<slug>/`), store (`/store/`), legal pages. The theater embeds
  the cartridge in a **same-origin iframe** at `/games/<slug>/play/`. Ads, leaderboards and the profile live in
  the shell, outside the playfield.
- **ArcadeSDK bridge.** The build injects `<script src="/sdk/arcade-sdk.js">` into the hosted copy of each
  cartridge. The SDK defines `window.ArcadeSDK` **only when framed by the same-origin theater**; otherwise the
  game sees no SDK and runs standalone. The SDK is a thin RPC client: every call is a `postMessage` to the
  parent theater (origin and `event.source` checked on both sides), resolves with a fallback on timeout, and
  never rejects. The theater owns all network, session, wallet and ad logic. Games never call `/api`.
- **One CSP for the site.** Instead of per-page CSPs (Pages merges overlapping `_headers` rules, which would
  intersect policies), the build emits one site-wide policy: `script-src 'self'` plus the sha256 of every
  cartridge's inline script, `style-src 'self'` plus cartridge style hashes, `connect-src 'self'`,
  `frame-src 'self'`, `frame-ancestors 'self'`. Portal pages use external same-origin JS/CSS only. This
  amends ADR 0006 (the cartridge-only CSP had `connect-src 'none'`); cartridges are still statically banned
  from network calls by `scripts/check.mjs`.

## Consequences

- Adding a game = drop the cartridge + one registry entry; the build creates its theater page, OG image,
  sitemap entry and CSP hashes. The contract is the "Game Cartridge Spec" in `AGENTS.md`.
- A game can be deployed elsewhere unchanged (the SDK tag only exists in the hosted copy).
- Because all games share an origin, a cartridge can read another game's `localStorage`. Games are first-party
  and reviewed; third-party games would need a separate origin and a sandboxed iframe (new ADR).
- Every new SDK method must define its fallback result, so a game never blocks on the platform.
