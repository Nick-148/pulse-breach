---
name: integrate-ad-sdk
description: Wire a real ad network (Google H5 Games Ads / AdSense, PokiSDK, CrazyGames SDK) into the arcade (portal HostAds for our own site, or a game's AdManager for a portal upload) safely, including CSP and consent. Use when an ad account is approved or a portal build is needed.
---

# Integrate a real ad SDK (ADR 0003, ADR 0007)

Precondition: the account/approval exists (otherwise this is Blocker B3; see handle-blocker).

1. **Pick the target.**
   - **Our own site** (seedfall-arcade): ads live in the portal, never in a cartridge.
     `portal/assets/js/ads.mjs` (`HostAds`) owns rewarded ads for every hosted game (they call
     `ArcadeSDK.ads.showRewarded`) and fills the `.ad-slot` banners on theater pages. Google H5 Games Ads is
     the natural choice.
   - **A portal upload** (Poki / CrazyGames): use `build/standalone/<slug>.html`; the game's own `AdManager`
     adapters (Pulse Breach) handle that portal's SDK. Portals forbid other ad networks.
2. **Load the SDK** on the theater page only (a `<script src>` added in `scripts/pages.mjs#theaterPage` behind a
   build flag/env var), never inside `games/*/index.html`, so cartridges stay zero-dependency.
3. **CSP**: add exactly the origins the SDK documents to `scripts/lib.mjs#buildCsp` (`script-src`,
   `connect-src`, `frame-src`, `img-src`). Write an ADR with the list and the reason. Keep `default-src 'none'`.
4. **Consent**: personalised ads in EU/UK need a CMP (Blocker B4) loaded before the ad SDK. Kids' audiences
   need non-personalised ads (B11).
5. **Adapter**: `sdkAdapters()` in `ads.mjs` already matches each SDK's documented API (H5 `adBreak`, Poki
   `rewardedBreak`, CrazyGames `requestAd`). Verify against the SDK's current docs; switch the default mode
   from `simulated` to `sdk` for production.
6. **Test**: rewarded placements grant only on completion; closing/failing/timeouts never grant and never
   freeze a game (`showRewarded` always resolves); VIP players get instant grants and no banners; banners
   never overlap the iframe on desktop or a portrait phone.
