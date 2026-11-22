# SPEC: Pulse Breach: Daily Run

The original product brief (as given by the founder on 2026-11-21), followed by the clarifications
gathered at kickoff. If code and spec disagree, fix one of them and record why in `PROGRESS.md`.

## 1. Core architectural constraints

- **Zero external dependencies.** No external JS libraries, fonts, audio files, or image assets. All graphics
  are procedural Canvas 2D primitives/glows/particles; all sound effects are synthesized via the Web Audio API
  (unlocked on first user gesture, with a mute toggle).
- **60 fps fixed-timestep / delta-clamped loop.** `requestAnimationFrame` with `dt` clamping (`Math.min(dt, 0.05)`),
  smooth on 60 Hz and 120 Hz displays.
- **Responsive viewport.** 16:9 centered on desktop; mobile portrait/landscape without page scrolling (`touch-action: none`).

## 2. Core gameplay loop: 60-second daily survival

- Survive a 60 s escalating wave sequence (then **Overdrive** for endless bonus points) while collecting
  **Data Shards** to build a combo multiplier and dodging hazards.
- **Desktop:** WASD/Arrows to steer, Space (or Shift) for **Phase Dash** (brief invulnerability + cooldown).
- **Mobile/mouse:** relative touch/mouse drag (finger doesn't cover the ship) + double-tap or on-screen button for dash.
- Waves (6 × 10 s):
  1. 0–10 s: drifting asteroid debris + single shards (warm-up, immediate flow)
  2. 10–20 s: sweeping laser beams (telegraphed warning line for 1.2 s before firing)
  3. 20–30 s: hunter drones (track slowly; can be baited into colliding with each other)
  4. 30–40 s: pulse rings / gravity wells + high-value golden cores
  5. 40–50 s: crossfire lasers + fast meteor swarms
  6. 50–60 s: "Core Meltdown": dense shrapnel + double shard spawn rate
  7. 60 s+: Overdrive, endless scaling speed until hull breach
- **Juice:** hitstop (30 ms on near-miss/dash-through), directional particle bursts, floating `+100 x4` popups,
  subtle screen shake, **Near-Miss Graze** bonus.

## 3. Deterministic daily seed & viral sharing loop

- Seeded PRNG (`mulberry32`): same seed ⇒ same wave spawns, hazard angles, shard placements.
- **Daily Challenge (default):** seed from today's UTC date (`DAILY-YYYY-MM-DD`); tracks Daily Best, Current Daily
  Streak and Attempt # in `localStorage`.
- **Friend Challenge (`?seed=XXXXXX`):** loads that seed and shows "CHALLENGE MODE: Beat your friend's run!".
- **Practice / Endless:** random seed.
- **Spoiler-free result card:** 6 ten-second blocks as emoji (🟩 clean, 🟨 close call/shield hit, 🔥 high combo,
  💀 crash, ⬛ not reached); Survival Time, Final Score, Max Combo, Seed ID; one-click Share/Copy (clipboard +
  `navigator.share` on mobile) with a `?seed=` URL and a "Copied!" toast.

## 4. Persistent progression (`localStorage`, keys `pulse_breach_v1_*`)

- Scrap bank + upgrades, 3 tiers each: Magnet Radius, Dash Cooldown, Aegis Shield (absorbs a fatal hit per run).
- 4 unlockable neon hull trail / colour palettes bought with Scrap.

## 5. Monetization & ad architecture (`AdManager`)

- Banner slot `#banner-ad-slot` outside the canvas container (728×90 desktop, 320×50 mobile), clearly separated.
- Rewarded placements: **Second Chance Revive** (once per run, respawn at the same timestamp with 2.5 s
  invulnerability), **2x Run Scrap Payout** (game over screen), **Hangar Scrap Top-Up (+100)**.
- Corner toggle `Ad Mode: Simulated` / `SDK Hooks`. Simulated: 5 s countdown modal ("Rewarded Ad Playing... 5s")
  that pauses game audio and grants on completion. SDK Hooks: stubbed callbacks ready for Google H5 Games Ads
  (`adBreak`), PokiSDK and CrazyGames SDK.

## 6. Code organisation & output

- JS sections: Config & SeededPRNG, AudioSynth, AdManager, GameEngine, Renderer, UIManager.
- Entire file complete: no TODO placeholders; deployable to Cloudflare Pages as-is.

## 7. Process requirements

- AGENTS.md + skills with concrete guidelines; PLAN.md roadmap; PROGRESS.md log; `docs/adr/` decisions.
- When blocked: document, stub behind an interface, move on.
- Code review before every commit; commit and push.
- Questions only until 03:00, autonomous until 04:00 on 2026-11-21.

---

## Clarifications (kickoff Q&A, 2026-11-21 02:52 ET)

| # | Question | Answer | Consequence |
| - | -------- | ------ | ----------- |
| 1 | Where should the game live? (session opened in the charcoal-bags repo) | New `~/Developer/pulse-breach` with its own git repo | Separate repo; charcoal-bags untouched |
| 2 | Which remote? | Initially `gitlab.com/Nick-148/pulse-breach`; mid-session the founder sent `https://github.com/Nick-148/pulse-breach.git` | Push to GitHub (latest instruction wins) |
| 3 | Do upgrades and the revive ad apply in Daily/Challenge runs? | **Apply everywhere** | Share card marks runs that used upgrades (`🛠 M2·D1·A0`) or a revive (`♻️ revived`) so comparisons stay honest |
| 4 | How far to take deployment tonight? | "Something else" (no detail given) | Interpreted as: prepare everything (build, `_headers`, wrangler script, runbook covering both direct upload and Git integration) and leave the publish to the founder (Blocker B1) |

### Decisions made autonomously (no answer needed, recorded for review)

- **Title:** kept "Pulse Breach: Daily Run".
- **Domain:** `pulsebreach.io` used as the placeholder canonical URL (`CONFIG.canonicalUrl`); share links use the
  live origin, so they work on `*.pages.dev` before a domain exists.
- **Arena:** fixed 1280×720 world for fairness; portrait screens rotate the view 90° (ADR 0004).
- **Friend challenge target:** share URLs include `&beat=<score>` so the banner can show the score to beat.
- **Scrap economy:** `floor(score / 200) + floor(seconds survived)` per run; upgrade costs 60/160/360 (Aegis 90/220/450);
  palettes 150/250/400/650.
- **Combo:** multiplier `1 + floor(chain / 4)`, max x10, 3 s window; 🔥 block at x6+.
- **Aegis tiers:** 1 charge / 1 charge + shockwave / 2 charges + shockwave.

---

# Brief 2 (2026-11-21 evening): Web Arcade Platform

Source: the founder pasted a brief for a production-grade, zero-upfront-cost web arcade (Roblox/Coolmath
hybrid) hosting single-file games, starting with Pulse Breach and **Neon Drift: Salvage Run**. Summary of
the requirements:

1. **Guardrails**: free tiers only (Cloudflare Pages/Functions + D1/KV or Supabase; Stripe for optional
   purchases); guest-first play in under 2 s with automatic merge into an account (Google / magic link /
   username); asynchronous multiplayer only (daily global seeds, global + friends leaderboards,
   `?seed=&beat=` links, ghost replays); per-game SEO routes with OG tags and below-the-fold copy.
2. **Architecture**: portal shell (home with featured Daily Challenge, categories *Reflex & Dodge, Timing &
   Rhythm, Logic & Puzzle, Arcade & Upgrades*, trending ticker, instant-play cards; theater `/games/[slug]`
   with leaderboard sidebar/drawer, challenge generator, 728×90 / 320×50 ad slots outside the playfield;
   profile & wallet (Arcade Credits, Gems/VIP, cosmetics, streak, bests); store `/store` behind a
   `PaymentProvider`). Bridge `window.ArcadeSDK`: `init`, `submitScore` (with anti-cheat: plausibility,
   duration, HMAC/session nonce), `wallet.getBalance/grant/spend`, `ads.showRewarded`, `share.challenge`.
3. **Growth**: one featured daily game with a 2x credit multiplier and top-50 daily board; challenge-a-friend
   links with a "TARGET TO BEAT" banner; cross-game daily/weekly quests.
4. **Discipline**: work only inside this directory; AGENTS.md with a strict Game Cartridge Spec; PLAN /
   PROGRESS / ADRs; server-side validation, rate limits, username sanitising, verified Stripe webhooks;
   games playable offline/standalone; tests for the SDK, score validation, guest merge, seed determinism;
   self-review before every commit.

## Decisions made autonomously (no questions asked; recorded for review)

| Topic | Decision | Where |
| ----- | -------- | ----- |
| Where it lives | This repo becomes the platform monorepo ("work strictly inside the current project directory") | ADR 0007 |
| Backend | Cloudflare Pages Functions + D1 (one vendor) over Supabase | ADR 0008 |
| Brand | "Seedfall Arcade", provisional, one constant | `shared/site.mjs`, PLAN B10 |
| Username sign-in | Server-generated Arcade Key instead of user passwords (no reuse, no slow hashing on the free CPU budget) | ADR 0009 |
| Google / magic link | Provider stubs until an OAuth client / email provider exist; no emails stored | ADR 0009, PLAN B7/B8 |
| Guests on leaderboards | Guests can't appear; their runs are kept as signed pending claims for 24 h and submitted on sign-up | ADR 0010 |
| All-time board | Built from daily-seed runs only (no farming easy custom seeds) | ADR 0010 |
| Wallet | Append-only ledger; client grants only for capped reasons; featured-game credits in their own bucket | ADR 0010 |
| Friends | One-way follow by friend code; friends board = people you follow + you | `server/account.mjs` |
| Ghosts | 10 Hz positions; kept only for a player's best run per seed; `&ghost=` in challenge links | `shared/validate.mjs` |
| Quests | Daily only (weekly in PLAN); deterministic from the UTC date | `shared/quests.mjs` |
| Store | Stripe Checkout via REST + signed webhooks; "coming soon" until keys exist; simulated in dev only | ADR 0011 |
| Ads | Portal-owned `HostAds` (simulated / SDK adapters / VIP instant); player-visible ad toggle removed when hosted | `portal/assets/js/ads.mjs` |
| CSP | One site-wide policy, no hashes: hosted cartridges are externalised at build | ADR 0007 |
| Neon Drift design | Original one-button tether/slingshot salvage game; fuel economy; mines; beacons relocate every 10 s | `games/neon-drift/` |
| Daily seed format | Kept `DAILY-YYYY-MM-DD` per game (the brief's `?seed=2026-11-21` example also works as a custom seed) | AGENTS.md |
