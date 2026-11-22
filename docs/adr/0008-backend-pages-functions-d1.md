# ADR 0008: Backend on Cloudflare Pages Functions + D1, ledger-based wallet

- Status: accepted
- Date: 2026-11-21

## Context

Leaderboards, cloud saves, a shared wallet, quests and purchases need a server. Budget is ~$0 until revenue.
Options: Supabase free tier (Postgres + Auth, but a second vendor, pauses inactive projects, separate secrets)
or Cloudflare Pages Functions + D1 (same deploy as the static site, SQLite, generous free tier: 100k
requests/day on Functions, 5M rows read and 100k rows written per day on D1).

## Decision

- **Cloudflare only.** `functions/api/[[path]].js` routes every `/api/*` request into `server/router.mjs`.
  Static pages never invoke Functions, so they don't count against the free quota.
- **D1 (SQLite)** with plain SQL migrations in `migrations/`. No ORM, no runtime npm dependencies.
- **Handlers are portable.** Server code uses only Web-standard APIs (`Request`, `Response`, `crypto.subtle`)
  and a D1-shaped `env.DB`. Tests and the local dev server run the same code against `node:sqlite` through
  `scripts/sqlite-d1.mjs` (same SQL dialect), so no Wrangler is needed to develop or test.
- **Wallet = append-only ledger.** A balance is `SUM(delta)` over the player's ledger rows. Every mutation is a
  single conditional `INSERT … SELECT … WHERE` (balance and daily caps checked inside the statement), so there is
  no read-modify-write race and every credit has an audit trail. Idempotency comes from a unique
  `(player_id, reason, ref)` index (quest claims, purchases, guest merges).
- **Graceful degradation.** If `env.DB` is missing or the API is down, `/api` returns 503 and the portal falls
  back to guest mode; games keep working because the SDK resolves fallbacks.

## Consequences

- Free-tier ceiling is roughly 25–30k submitted runs/day (each run writes ~3 rows). Past that, Workers Paid
  ($5/month) raises limits ~500x with no code change.
- D1 has no interactive transactions: multi-statement work uses `db.batch()` (atomic), and correctness must not
  depend on reading then writing in separate requests.
- Schema changes go through numbered migrations, applied with `wrangler d1 migrations apply` (runbook).
