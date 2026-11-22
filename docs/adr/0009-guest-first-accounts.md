# ADR 0009: Guest-first accounts: username + Arcade Key, OAuth/magic link behind providers

- Status: accepted
- Date: 2026-11-21

## Context

Players must reach gameplay in under 2 s with no sign-up. An account is only needed to claim a leaderboard
spot, sync currency across devices, or buy something. Google sign-in needs an OAuth client (founder action);
magic links need an email provider (cost, deliverability, stores email addresses = PII). The audience of a
"Coolmath-style" arcade includes children, so collecting less personal data is safer (COPPA / GDPR-K).

## Decision

- **Guests** keep progress in `localStorage` (`arcade_v1_*`): credits, streak, quest claims, and pending
  score submissions. Guest data is untrusted; on sign-in it is merged by `planGuestMerge` with hard caps,
  once per guest id (ledger idempotency).
- **Username + Arcade Key** is the built-in provider: the player picks a username (validated, profanity
  filtered, case-insensitive unique) and the server generates a 100-bit key, shown once. Only `SHA-256(key)`
  is stored. A server-generated high-entropy secret makes slow password hashing unnecessary (which also fits
  the Workers free-tier CPU limit) and rules out password reuse. The login form uses
  `autocomplete="username"` / `"current-password"` so password managers save the key.
- **Google OAuth and magic link** exist behind an `AuthProvider` registry and report `enabled: false` until
  configured (blockers in PLAN.md). No email addresses are stored today.
- **Sessions**: 256-bit random token in an `HttpOnly; Secure; SameSite=Lax` `__Host-` cookie, stored hashed,
  30-day expiry. State-changing requests must be JSON and same-origin (`Origin` check) to stop CSRF.
- **Privacy**: no real names, emails or analytics. IP addresses are only used as daily-rotating salted
  hashes for rate limiting. Players can delete their account (cascades all rows).

## Consequences

- A player who loses their key can't recover the account until an email/OAuth provider is added.
- Usernames appear on public leaderboards, so the filter (`shared/names.mjs`) must stay conservative, and
  there must be a way to rename or remove abusive names (admin task, not built yet).
- Before launching to children, the founder needs a legal review (COPPA, GDPR-K): see PLAN.md blockers.
