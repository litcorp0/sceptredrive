# 18-04 — The till

**Must be true:** with an empty search there are no product cards; an out-of-stock hit is dimmed,
`aria-disabled` and not addable; a manager PIN adds it; the sale records an oversell conflict.

Tasks
1. Settings `pos.outOfStockPolicy` (`BLOCK` | `WARN` | `ALLOW`, default `BLOCK`, branch-scoped,
   manager-writable) and `pos.lowStockThreshold` derived from the inventory default; both in
   `PosRuntimeConfig` and the session snapshot.
2. `stockBadge(available, threshold)` — the hard-coded 5 goes.
3. `ProductGrid`/`ProductCard`: `policy` + `onOverride`; blocked cards are dimmed, disabled,
   focusable-but-not-activatable, labelled.
4. `ProductSearch`: render the grid only when the query is non-empty; empty state invites a
   scans; the blocked-card override opens `ManagerOverrideDialog` with `inventory.adjust`.
5. `override-service`: `inventory.adjust` joins `OverridePermission` with the reason code
   `STOCK_DISCREPANCY` (the proof is local; the server's conflict is the record).

Verification: desktop tests for the badge threshold and the blocked-card decision; sell page
typecheck; counter audit unaffected on the sync screen.
