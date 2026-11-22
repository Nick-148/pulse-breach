# ADR 0010: Anti-cheat with signed run tokens; server-authoritative economy

- Status: accepted
- Date: 2026-11-21

## Context

Leaderboards and a shared wallet are worthless if the client decides scores and balances. The games run fully
client-side, so perfect anti-cheat is impossible without server-side simulation; we need cheap checks that stop
casual tampering (devtools, replayed requests, impossible numbers) on the free tier.

## Decision

- **Run tokens.** When a hosted run starts, the theater requests `POST /api/runs {game, seed}` and gets an
  HMAC-SHA256-signed token `{rid, game, seed, issuedAt}` (secret `RUN_SECRET`). Guests get tokens too, so a
  run played as a guest can still be claimed after signing in (token valid 24 h).
- **Submission checks** (`shared/validate.mjs`, unit-tested): valid signature; token game and seed match;
  the run id is unused (unique `scores.run_id`); survival time ≤ wall-clock time since the token was issued
  (+1.5 s; game time can never run faster than real time); score ≤ the game's `maxScore(seconds)` bound from
  `shared/games.mjs`; ghost data shape and bounds; per-player rate limit.
- **Daily boards only count daily seeds.** All-time boards are built from daily-seed runs, so nobody can farm
  an "easy" custom seed. Challenge and practice runs still earn credits.
- **Economy rules live on the server** (`shared/economy.mjs`): run credits are computed from the validated
  score with a daily cap (2x for the featured game); `wallet.grant` from a game is capped per game per day;
  rewarded-ad credits are capped per day; prices come from the server catalog, never from the client.
- **Guest balances** follow the same rules locally, and are capped again when merged.

## Consequences

- A determined cheater can still forge a plausible score within bounds. Next step (documented, not built):
  record inputs and re-simulate the deterministic engine server-side to verify the exact score.
- Tuning `maxScore` too tight rejects real players; the bounds are generous and should be tightened with real
  score distributions.
- Losing `RUN_SECRET` invalidates in-flight tokens only (24 h); rotating it is safe.
