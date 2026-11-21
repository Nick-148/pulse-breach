# Pulse Breach: Daily Run

A 60-second daily survival arcade game in a **single, zero-dependency HTML file**. Everyone gets the same
seeded run each UTC day; dodge, dash, graze, chain shards, then share a spoiler-free emoji card that
challenges friends to the exact same run.

- Play locally: `npm run dev` → http://localhost:4173 (or just open `src/index.html`)
- Controls: WASD / Arrows + Space/Shift to dash · Touch: drag anywhere + double-tap or the DASH button
- Modes: Daily (default) · Friend Challenge (`?seed=XXXX&beat=1234`) · Practice (random seed)

```bash
npm install && npx playwright install chromium
npm run verify      # static checks + unit tests + build
npm run test:e2e    # Playwright, desktop + mobile, under the production CSP
```

Deploy: see `docs/runbooks/deploy.md` (Cloudflare Pages, output dir `dist`).
Contributing: read `AGENTS.md` first.
