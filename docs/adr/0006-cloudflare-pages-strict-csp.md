# ADR 0006: Cloudflare Pages with a hash-pinned CSP

- Status: accepted; amended by ADR 0007 (one site-wide CSP, hosted cartridges externalised, `connect-src 'self'` for the portal)
- Date: 2026-11-21

## Context

The game is static. Cloudflare Pages is free, global, and supports a `_headers` file. Inline script/style are
required by the single-file constraint, which normally pushes people to `'unsafe-inline'`.

## Decision

- `npm run build` copies `games/pulse-breach/index.html` to `dist/` and generates `dist/_headers` with
  `script-src 'sha256-…'` / `style-src 'sha256-…'` computed from the exact inline bodies, plus
  `default-src 'none'`, `connect-src 'none'`, `img-src 'self' data:`, `base-uri 'none'`, `form-action 'none'`,
  `frame-ancestors 'self'`, HSTS, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP.
- `scripts/serve.mjs` applies the same `_headers` locally; e2e runs against it and fails on any CSP violation.
- The raw `games/pulse-breach/index.html` still works when opened directly or uploaded elsewhere (it just lacks the headers).

## Consequences

- Never edit `dist/` by hand; always rebuild (hashes must match byte-for-byte).
- Cloudflare zone features that rewrite HTML (Email Obfuscation, Rocket Loader, auto-injected Web Analytics)
  would break the CSP: keep them off for this project (runbook).
