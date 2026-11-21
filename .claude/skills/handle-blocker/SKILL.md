---
name: handle-blocker
description: What to do when Pulse Breach work is blocked on an external dependency (Cloudflare login, domain, ad network approval, consent platform, founder decision) — document, stub behind an interface, move on. Use whenever progress depends on something you cannot get right now.
---

# Handle a blocker (ADR 0005)

1. **Confirm it's really external.** Missing credentials, accounts, purchases, approvals, or a product decision
   only the founder can make. Anything you can decide with a sensible default is not a blocker: decide it,
   record it in `docs/SPEC.md → Decisions made autonomously`, move on.
2. **Document** a row in `PLAN.md → Blockers`: ID, what, why it blocks, who unblocks, date (absolute),
   stub/workaround.
3. **Stub behind an interface.**
   - Follow the `AdManager` adapter pattern: a list of providers with the same contract, the first available wins,
     a stub at the end that implements the real contract.
   - The stub must be clearly labelled (UI text or `console.info`) and must never be able to break gameplay
     (wrap with `safeCall` / `withTimeout`, resolve instead of reject).
   - Never add a stub that silently fakes something in production if that would mislead players or partners;
     list it in PLAN Milestone 2 to remove before launch.
4. **Test the stub path** (unit or e2e) so swapping in the real dependency is a config change.
5. **Log** in `PROGRESS.md` and continue with the next unblocked PLAN item.
