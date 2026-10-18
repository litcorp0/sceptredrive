---
phase: 03-inventory-transfers
plan: 02
wave: 2
title: Inventory core service — ledger, projection, average cost, guards
requirements: [INV-01, INV-02, INV-03, INV-09]
depends_on: [01]
status: planned
created: 2026-10-18
---

# Plan 02 — Inventory Core Service

**Goal:** One single-writer service posts stock movements with correct per-branch
weighted-average costing and negative guards, keeping the projection exactly equal to the
ledger; product archive and warehouse-terminal guards enforce the new invariants.

## Task 1 — Movement posting, projection, and reads

**Files:** `packages/shared/src/permissions.ts`, `packages/shared/src/permissions.test.ts`,
`api/src/modules/inventory/inventory.repository.ts`,
`api/src/modules/inventory/inventory.types.ts`,
`api/src/modules/inventory/inventory.service.ts`

- Permissions registry: add `inventory.read`, `inventory.receive`, `inventory.adjust`,
  `inventory.transfer`, `inventory.count`, `inventory.threshold`; grant all to ADMIN and
  MANAGER (D8); extend the shared permission tests.
- Types: `StockMovementType`, `MovementInput { productId, branchId, type, quantityDelta,
  unitCostMinor, referenceType, referenceId?, referenceNumber?, reasonCode?, note? }`,
  `PostedMovement`, `StockLevelRow`, `OnHandTotals`.
- Repository (Drizzle only, no business logic):
  - `lockOrCreateLevel(productId, branchId, tx)` — `INSERT ... ON CONFLICT DO NOTHING`
    then `SELECT ... FOR UPDATE`; returns the locked row.
  - `insertMovement(input, actorId, tx)`, `updateLevel(id, { quantityOnHand, avgCostMinor }, tx)`,
    `findLevel(productId, branchId, executor)`, `listLevels(branchId, filters)`,
    `sumMovementsByProduct(branchId, tx)` (reconciliation), `selectMovementPage(filters)`,
    `countMovements(filters)`, `sumProductDeltas(productId)` (cross-branch total for the
    archive guard). No update/delete helpers for movements — none may ever be added.
- Service `postMovements(actor, inputs, tx?)`: dedupe/validate (non-zero integer deltas,
  safe ints, non-negative costs); **sort inputs by productId**; for each input
  lock-or-create the level row, then:
  - `RECEIPT` / `TRANSFER_IN`: `newAvg = qtyBefore <= 0 ? unitCost
    : Math.round((avgBefore * qtyBefore + unitCost * received) / (qtyBefore + received))`;
    `newQty = qtyBefore + delta`.
  - `ADJUSTMENT` (positive), `COUNT_VARIANCE` (positive): `newQty = qtyBefore + delta`;
    `unitCostMinor` stored is the current average; average unchanged.
  - All outbound types: `newQty = qtyBefore + delta` (delta negative). Guard
    `newQty >= 0` unless `options.allowNegative === true` (only Phase 6 will pass it;
    Phase 3 never does) → `ConflictError` with product/branch context.
  - Update level and insert movement (with the cost snapshot) in the same transaction.
- Read helpers: `getLevel(user, productId, branchId)` (branch access asserted),
  `listStock(user, filters)` with search + low-stock join + pagination,
  `listMovementHistory(user, filters)`, `getOnHandTotal(productId, executor?)` (internal
  read for the archive guard), `reconcileBranch(branchId)` — returns rows where
  `level.quantity_on_hand !== SUM(delta)`.

**Verify:** `bun run --filter shared test`; `bun run --filter api check-types`;
service-level tests come in Task 2.
**Commit:** `feat(api): add stock movement posting and level projection`

## Task 2 — Costing, guard, and concurrency tests

**Files:** `api/src/modules/inventory/inventory.test.ts` (integration, `gikautos_test`)

- Invariant: after a mixed batch (receipt → adjustment → outbound), `quantity_on_hand ===
  SUM(quantity_delta)` for every product/branch; `reconcileBranch` returns no rows.
- Average cost: first receipt adopts its cost; second receipt blends
  (`(avg*q + c*r)/(q+r)`, half-up rounding, integer assert); outbound via any type leaves
  average unchanged; receipt after on-hand reached 0 replaces the average outright;
  transfer-in blends at the carried cost.
- Guards: outbound beyond on-hand → 409 and **no movement written** (rollback);
  multi-line posting where the second line fails rolls back the first (atomicity);
  zero/negative/NaN/non-integer deltas → 400.
- Concurrency: two parallel `postMovements` outbound calls on a level with qty 1 —
  exactly one succeeds, the other 409s, final level is 0, ledger sums to 0 (real DB, no
  mocked tx).
- Append-only: repository module exports no movement update/delete (assert by source
  scan in the test: `grep` the repository file for `delete(stockMovement)`/
  `update(stockMovement)` — keep it a simple string assertion).

**Verify:** `bun run db:test:prepare && bun run test` green (whole suite, parallel-safe
fixtures with scoped cleanup).
**Commit:** `test(api): prove ledger invariant, costing, guards, and concurrency`

## Task 3 — Archive and warehouse-terminal guards

**Files:** `api/src/modules/products/products.service.ts`,
`api/src/modules/products/products.test.ts`,
`api/src/modules/org/terminals.service.ts`, `api/src/modules/org/terminals.test.ts`

- `archiveProduct` calls `inventoryService.getOnHandTotal(productId, tx)` inside its
  existing transaction and throws
  `ConflictError('Cannot archive a product with stock on hand')` when the total ≠ 0
  (before the update; audit unchanged).
- `terminalsService.createTerminal` throws
  `ConflictError('Warehouses cannot host POS terminals')` when the parent branch type is
  `WAREHOUSE` (keep the existing inactive-branch guard first).
- Tests: archive blocked with stock, allowed at zero; terminal 409 for warehouse,
  retail unaffected; manager archive attempt still 403 (permission) — order of checks.

**Verify:** `bun run test`; `bun run lint`; `bun run check-types`.
**Commit:** `feat(api): guard product archive and warehouse terminals`

## Done When

One service owns every movement write; levels always equal ledger sums; costing matches
the locked WAC rules with integer math; negative results are impossible in back-office
paths and proven under concurrency; archive and warehouse guards are enforced and tested.
