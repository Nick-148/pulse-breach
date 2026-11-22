# ADR 0011: Payments via a PaymentProvider interface, Stripe Checkout first

- Status: accepted
- Date: 2026-11-21

## Context

Optional purchases (VIP ad-free pass, cosmetic bundle, credit/gem packs) need card payments without PCI scope,
without an npm dependency, and must not block development while the Stripe account doesn't exist.

## Decision

- `server/payments.mjs` defines `PaymentProvider { id, enabled, createCheckout(), verifyWebhook() }` with:
  - **stripe**: creates a Checkout Session through Stripe's REST API with `fetch` (inline `price_data`, so no
    dashboard products are needed), redirects the player to Stripe's hosted page, and fulfils only from the
    `checkout.session.completed` webhook after verifying the `Stripe-Signature` HMAC (5-minute tolerance,
    constant-time compare). Event ids and session ids are stored, so retries never double-grant.
  - **disabled** (default when keys are missing): the store shows "coming soon"; nothing is charged.
  - **simulated** (only when `DEV=1`, local dev and e2e): fulfils immediately so the flow can be tested.
- The catalog (`shared/catalog.mjs`) is the only source of prices. The client sends a SKU; the server prices it.
- Card data never touches our servers or pages. The only outbound origin is `api.stripe.com` from the
  Function; the browser navigates to `checkout.stripe.com` (top-level navigation, not a CSP resource).

## Consequences

- Founder must create a Stripe account and set `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` (PLAN.md blocker).
- Selling to minors and selling consumable currency carry legal obligations (refund policy, terms, parental
  consent): the store stays disabled until the founder signs off.
- Swapping to Paddle or Lemon Squeezy (merchant of record, handles VAT) is a new provider, not a rewrite.
