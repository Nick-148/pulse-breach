# Runbook: deploy Seedfall Arcade to Cloudflare Pages

What ships: `dist/` (static portal, hosted games, `_headers`, `_routes.json`) + `functions/` (the `/api`
Pages Function) + a D1 database. Static pages never invoke the Function, so they're free and unlimited.

Everything below needs the founder's Cloudflare account (PLAN.md B1). Total first-time setup: ~20 minutes.

## 1. One-time setup

```bash
npx wrangler@3 login
npx wrangler@3 d1 create arcade                 # prints a database_id
cp wrangler.example.toml wrangler.toml          # paste the database_id into wrangler.toml
npm run db:migrate:remote                       # applies migrations/*.sql to the real D1
```

Create the Pages project (either way works):

- **Git integration (recommended)**: dashboard → Workers & Pages → Create → Pages → Connect to Git →
  `Nick-148/pulse-breach`. Build command `npm run build`, output `dist`, env var `NODE_VERSION=22`.
  The `functions/` folder is picked up automatically. Every PR gets a preview URL.
- **Direct upload**: `npm run deploy` (verify + `wrangler pages deploy dist --project-name seedfall-arcade`).

Bindings and secrets (Pages project → Settings):

| Name | Kind | Value | Needed for |
| ---- | ---- | ----- | ---------- |
| `DB` | D1 binding | the `arcade` database | everything online (without it the site runs guest-only) |
| `RUN_SECRET` | Secret | `openssl rand -base64 48` | signing run tokens (without it leaderboards show "offline") |
| `SITE_URL` | Variable (build) | `https://<your domain>` | canonical/OG/sitemap URLs (default `https://seedfall-arcade.pages.dev`) |
| `STRIPE_SECRET_KEY` | Secret | `sk_live_…` / `sk_test_…` | store checkout (PLAN B6) |
| `STRIPE_WEBHOOK_SECRET` | Secret | `whsec_…` | fulfilling purchases (PLAN B6) |

`wrangler pages secret put RUN_SECRET --project-name seedfall-arcade` sets a secret from the terminal.
**Never** set `DEV` or `PAYMENTS_SIMULATED` in production (they disable `Secure` cookies / enable free purchases).

## 2. Every deploy

1. `npm run verify && npm run test:e2e` (e2e in CI if Playwright hangs locally).
2. New migration files? Apply them **before** the code that needs them: `npm run db:migrate:remote`.
3. Gameplay generation changed? Deploy just after 00:00 UTC (see "Changing gameplay generation").
4. Push to `main` (Git integration) or `npm run deploy`.

## 3. Smoke test after deploy (5 minutes)

```bash
curl -sI https://<site>/ | grep -iE 'content-security-policy|strict-transport|x-content-type'
curl -s https://<site>/api/health          # {"ok":true,"db":true}
curl -s https://<site>/api/config | head -c 300   # leaderboards: true, payments provider
```

Then in a private window: home loads with no console errors → open a game → play → breach → challenge card
appears → create an account → the run shows on the daily board → open the challenge link in another browser
→ "TARGET TO BEAT" + ghost.

## 4. Stripe (when B6 is unblocked)

1. Stripe dashboard → Developers → API keys → set `STRIPE_SECRET_KEY` (start with test mode `sk_test_`).
2. Developers → Webhooks → Add endpoint `https://<site>/api/store/webhook`, events
   `checkout.session.completed` and `checkout.session.async_payment_succeeded` → copy the signing secret into
   `STRIPE_WEBHOOK_SECRET`.
3. Buy each product once in test mode with card `4242 4242 4242 4242`; check the items/gems/VIP arrive.
4. Only then switch to live keys. Prices live in `shared/catalog.mjs`.

## 5. Custom domain

1. Buy the domain (Cloudflare Registrar keeps DNS in one place) → Pages → Custom domains → add it.
2. Set `SITE_URL` to the new origin and redeploy (canonical, OG and sitemap URLs use it).
3. Update the Stripe webhook URL if the store is live.
4. Keep these zone features **off** (they rewrite HTML and break the CSP): Email Address Obfuscation,
   Rocket Loader, automatic Web Analytics injection.

## 6. Operations

- **Logs**: Pages project → Functions → Real-time logs (`api-error` lines include method + path, never bodies).
- **Free-tier ceilings**: 100k Function requests/day, D1 5M rows read / 100k rows written per day (~25–30k
  submitted runs/day). Past that: Workers Paid ($5/month), no code change.
- **Moderation**: remove an abusive username with
  `npx wrangler@3 d1 execute arcade --remote --command "UPDATE players SET username = 'Player_' || substr(id, 1, 6) WHERE username_key = 'badname'"`.
- **Housekeeping** (monthly): `DELETE FROM runs WHERE created_at < <90 days ago> AND ghost IS NULL AND id NOT IN (SELECT run_id FROM bests)`.
- **Backups**: D1 Time Travel restores any minute in the last 30 days (`wrangler d1 time-travel`).

## 7. Rollback

Pages → Deployments → previous good deployment → **Rollback** (instant). Migrations are forward-only: write
additive migrations (new columns nullable) so old code keeps working against the new schema.

## Changing gameplay generation

Edits to a game's `generateSegment` / gameplay `CONFIG` change every seed. Deploy just after 00:00 UTC so one
daily seed never has two layouts, bump the game's `VERSION`, and note it in `PROGRESS.md`.
