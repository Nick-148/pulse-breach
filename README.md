# Seedfall Arcade

A zero-upfront-cost web arcade of fast, single-file HTML5 Canvas games. Everyone plays the **same seeded run
each day**; finish a run, climb the daily leaderboard, and send friends a link that drops them into the same
seed with your score to beat and your ghost to race. Play instantly as a guest; create a free account (no
email) to claim leaderboard spots and sync across devices.

**Games**
- **Pulse Breach: Daily Run**: survive 60 seconds of seeded hazards, then endless Overdrive (`games/pulse-breach/`)
- **Neon Drift: Salvage Run**: one-button tether, swing and slingshot through a salvage field (`games/neon-drift/`)

Each game is one self-contained HTML file that also runs standalone (itch.io, Poki, CrazyGames, from disk).
Inside the arcade it talks to the platform through `window.ArcadeSDK`.

```bash
npm install && npx playwright install chromium
npm run dev         # http://localhost:4173 — portal + games + local API (SQLite)
npm run verify      # lint + static guards + 87 unit tests + build
npm run test:e2e    # Playwright, desktop + mobile, under the production CSP
```

- Architecture and rules for contributors (human or AI): **`AGENTS.md`** (includes the Game Cartridge Spec)
- Roadmap and blockers: `PLAN.md` · history: `PROGRESS.md` · decisions: `docs/adr/`
- Deploy (Cloudflare Pages + Functions + D1): `docs/runbooks/deploy.md`
