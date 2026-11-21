---
name: deploy
description: Build and deploy Pulse Breach to Cloudflare Pages and verify it (headers, CSP, smoke test, rollback). Use when asked to deploy, release, ship, or check a deploy.
---

# Deploy

Full details: `docs/runbooks/deploy.md`.

1. `npm run verify && npm run test:e2e`; stop on any failure.
2. If `generateSegment` or gameplay `CONFIG` changed: confirm it's just after 00:00 UTC (seeds change), `VERSION` bumped.
3. Deploy:
   - Git integration: push to `main` (Pages builds `npm run build` → `dist`).
   - Direct upload: `npx wrangler@3 pages deploy dist --project-name pulse-breach` (needs `wrangler login`:
     if not logged in, this is Blocker B1; hand the command to the founder rather than stalling).
4. Verify production:
   - `curl -sI <url> | grep -iE 'content-security-policy|strict-transport|x-content-type'`
   - Load the page with DevTools open: zero console errors, zero CSP violations.
   - Start a run, breach, share; open the copied `?seed=` link in a private window → challenge banner.
5. Rollback if anything is wrong: Pages → Deployments → previous → Rollback.
6. Record the deploy (URL, commit) in `PROGRESS.md`.
