# ADR 0004: Fixed 16:9 world, rotated view on portrait screens

- Status: accepted
- Date: 2026-11-21

## Context

Fair daily seeds require every player to play the same arena. Letterboxing a 16:9 arena on a portrait phone
would make it tiny; a per-device arena size would make seeds unfair.

## Decision

- The simulation world is always 1280×720.
- The renderer fits it to the stage; when the stage is taller than 1.15× its width, the view rotates 90°
  (canvas transform `(0, s, -s, 0, …)`), and touch/keyboard input is mapped through the same rotation.
- Text in the canvas is counter-rotated so it stays upright. HUD and menus are DOM, so they don't rotate.
- Device pixel ratio is capped at 2 for fill-rate on phones.

## Consequences

- Portrait players get a large arena and identical spawns. On portrait, "up" on screen is world-left; this is
  invisible to players because input is mapped too.
- Any new canvas text must use `Renderer.text()` to stay upright.
