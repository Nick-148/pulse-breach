# ADR 0003: AdManager as one interface with swappable providers

- Status: accepted
- Date: 2026-11-21

## Context

We need rewarded ads (revive, 2x scrap, +100 scrap) and a banner, but no ad network account exists yet
(Blocker B3), portals (Poki, CrazyGames) ship their own SDKs, and Google's H5 Games Ads uses `adBreak()`.
Ads must never break gameplay and must not weaken the CSP until we deliberately choose a network.

## Decision

- `AdManager.showRewarded(placement)` always resolves `{granted, reason}`; it never rejects.
- Mode `simulated`: a local 5 s countdown modal; audio is ducked; close = no reward.
- Mode `sdk`: first detected adapter wins: **Poki** (`PokiSDK.rewardedBreak`) → **CrazyGames v3**
  (`SDK.ad.requestAd('rewarded')`) → **H5 Games Ads** (`adBreak({type:'reward'})`) → **stub**. The stub implements
  the exact `adBreak` placement contract (`beforeReward(showAdFn)`, `adViewed`, `adDismissed`, `adBreakDone`),
  so swapping in the real SDK requires no game-code changes.
- All SDK calls are wrapped in `safeCall` / `withTimeout` (45 s reward, 8 s init).
- `gameplayStart/Stop` are forwarded to portal SDKs at run start/pause/breach.
- No SDK `<script>` is loaded by default; the CSP keeps `default-src 'none'`.

## Consequences

- Enabling a real network = load its script in a build variant + add its origins to `buildCsp` + update this ADR
  (and add a consent solution for EU/UK traffic: Blocker B4).
- Portal builds that are iframed need `frame-ancestors` to include the portal origin.
- The Ad Mode toggle is visible for testing; hide it before real ads go live (PLAN Milestone 2).
