# ADR 0005: When blocked, document → stub → move on

- Status: accepted
- Date: 2026-11-21

## Context

Many launch steps depend on the founder (accounts, domain, ad approval) who works ~10 hrs/week.
Work must not stall waiting on them.

## Decision

1. Record the blocker in `PLAN.md → Blockers` (what, why, who, since, workaround).
2. Put the dependency behind an interface with a safe stub/fake selected at runtime (model: `AdManager` adapters).
   Stubs must be obviously labelled in the UI or logs and must never be able to break gameplay.
3. Log it in `PROGRESS.md` and continue with the next unblocked task.

## Consequences

- The game is always shippable; integrations become drop-in replacements.
- Stubs that would be misleading in production (e.g. simulated ads granting rewards) are listed in PLAN
  Milestone 2 to be hidden/replaced before launch.
