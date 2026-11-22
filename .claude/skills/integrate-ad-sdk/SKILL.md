---
name: integrate-ad-sdk
description: Wire a real ad network (Google H5 Games Ads / AdSense, PokiSDK, CrazyGames SDK) into Pulse Breach's AdManager safely, including CSP and consent. Use when an ad account is approved or a portal build is needed.
---

# Integrate a real ad SDK (ADR 0003)

Precondition: the account/approval exists (otherwise this is Blocker B3; see handle-blocker).

1. **Pick the build target.** Own domain → Google H5 Games Ads. Portal upload → that portal's SDK only
   (portals forbid other ad networks).
2. **Load the SDK** in a dedicated build variant (extend `scripts/build.mjs` with a flag), not in `games/pulse-breach/index.html`,
   so the default build stays zero-dependency.
3. **CSP**: add exactly the origins the SDK documents to `buildCsp` for that variant (`script-src`, `connect-src`,
   `frame-src`, `img-src`). If the portal iframes the game, set `frame-ancestors` to the portal origin.
   Write/extend an ADR with the list and the reason.
4. **Consent**: personalised ads in EU/UK need a CMP (Blocker B4). Portals usually handle this; own domain does not.
5. **Adapter**: the adapters in `createSdkAdapters` already match each SDK's documented API. Verify against the
   SDK's current docs (APIs change): init call, rewarded call, gameplay start/stop, banner.
6. **Test**: switch Ad Mode to SDK Hooks; confirm the toggle label shows the detected provider id; verify the
   three placements grant only on completion and that closing/failing an ad never grants or freezes the game.
7. **Launch hygiene**: hide the Ad Mode toggle for players (PLAN Milestone 2) and remove Simulated as the default.
