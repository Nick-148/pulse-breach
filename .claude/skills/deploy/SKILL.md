---
name: deploy
description: Build and deploy Seedfall Arcade (static portal + /api Pages Function + D1) to Cloudflare Pages and verify it (migrations, secrets, headers, smoke test, rollback). Use when asked to deploy, release, ship, or check a deploy.
---

# Deploy

Full details: `docs/runbooks/deploy.md`.

1. `npm run verify && npm run test:e2e` (or a green CI run on the commit); stop on any failure.
2. If a game's `generateSegment` or gameplay `CONFIG` changed: confirm it's just after 00:00 UTC and that
   game's `VERSION` is bumped.
3. New files in `migrations/`? `npm run db:migrate:remote` **before** deploying code that needs them.
4. Deploy: push to `main` (Git integration) or `npm run deploy`. Not logged in to Cloudflare = Blocker B1:
   hand the founder the exact commands instead of stalling.
5. Verify production:
   - `curl -sI <site>/ | grep -iE 'content-security-policy|strict-transport|x-content-type'`
   - `curl -s <site>/api/health` → `{"ok":true,"db":true}`; `/api/config` → `leaderboards: true`.
   - Private window: home with zero console errors → play a game → challenge card → sign up → run on the board.
6. Rollback if anything is wrong: Pages → Deployments → previous → Rollback.
7. Record the deploy (URL, commit, migrations applied) in `PROGRESS.md`.
