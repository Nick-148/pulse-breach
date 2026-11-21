# Runbook: deploy to Cloudflare Pages

The site is static: `dist/index.html`, `dist/_headers`, `dist/robots.txt`. No secrets, no backend.

## Option A: Git integration (recommended: auto-deploys on push)

1. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git** → pick `Nick-148/pulse-breach`.
2. Build settings: **Framework preset** None · **Build command** `npm run build` · **Build output** `dist`
   · Environment variable `NODE_VERSION=20` (or newer).
3. Save and deploy. Preview deployments are created for every branch/PR automatically.

## Option B: Direct upload from this machine

```bash
npm run verify
npx wrangler@3 login
npx wrangler@3 pages deploy dist --project-name pulse-breach
```

(`npm run deploy` runs verify + the deploy command.)

## After the first deploy

1. Open `https://pulse-breach.pages.dev/` and check DevTools → Console: **no CSP errors**.
2. Check headers: `curl -sI https://pulse-breach.pages.dev/ | grep -i content-security-policy`.
3. Play a run, share, open the copied link in a private window → challenge banner appears.

## Custom domain (`pulsebreach.io` or other)

1. Buy the domain (Cloudflare Registrar keeps DNS in one place).
2. Pages project → **Custom domains → Set up a domain**.
3. Update `CONFIG.canonicalUrl` in `src/index.html` (used only when the page is opened from `file://`).
4. **Zone settings that must stay OFF** (they rewrite HTML and break the hash CSP): Email Address
   Obfuscation, Rocket Loader, Automatic HTTPS Rewrites is fine, Web Analytics *automatic setup* off
   (if analytics are wanted, see PLAN and write an ADR first).

## Rollback

Pages → project → **Deployments** → pick the previous good deployment → **Rollback to this deployment**.
It is instant; no data migration exists.

## Changing gameplay generation

Edits to `generateSegment` / gameplay `CONFIG` change every seed. Deploy them just after 00:00 UTC so a
single daily seed never has two different layouts, bump `VERSION`, and note it in `PROGRESS.md`.
