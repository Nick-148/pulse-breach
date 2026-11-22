# ADR 0001: Single-file, zero-dependency game

- Status: accepted
- Date: 2026-11-21

## Context

The brief requires one `index.html` with embedded CSS/JS, no external libraries, fonts, images or audio,
deployable to Cloudflare Pages as-is. The founder has ~10 hrs/week; fewer moving parts is a feature.

## Decision

- The game is `games/pulse-breach/index.html`: exactly one `<style>` and one `<script id="game-script">` (strict-mode IIFE).
- Graphics: Canvas 2D primitives with additive-blend glows. Audio: Web Audio oscillators + a generated noise buffer.
- Tooling (build, check, serve, tests) is Node built-ins only; the sole devDependency is `@playwright/test`.
- `scripts/check.mjs` enforces: no remote `src/href`, no external stylesheets/imports, no network APIs, no HTML-string
  sinks, no `eval`, no inline handlers/styles, size budget (160 KiB), no TODO/FIXME.

## Consequences

- No bundler, no transpiler: the file you edit is the file that ships. Easy to reason about, easy to deploy.
- A large single file needs discipline: numbered sections, pure functions, and the `PulseBreach` test API.
- Anything that wants a third-party script (real ads, analytics) is a deliberate exception needing its own ADR.
