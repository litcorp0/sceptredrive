---
phase: 08-admin-modules-shell
plan: 06
wave: 6
title: Inventory module — stock, receipts, transfers, counts
requirements: [UIX-06]
depends_on: [05]
status: planned
created: 2026-10-24
---

# Plan 06 — `modules/inventory`

**Goal:** The biggest module in the phase: twelve routes (2,222 lines), eleven components, three
API groups, and the only remaining cross-module import that points at a domain that has not
migrated yet.

Route lines: layout 58, index 7, stock list 225, stock detail 233, receipts list 181, receipt
detail 192, transfers list 198, transfer new 191, transfer detail 209, counts list 167, count new
166, count detail 372.

## Task 1 — Layout, API, and types (no screens yet)

**Files:** new `admin/src/modules/inventory/{api,types,utils,pages/inventory-layout.tsx}`;
`admin/src/routes/_authenticated/inventory/route.tsx`; `lib/api.ts`; `lib/api-types.ts`

- `pages/inventory-layout.tsx` from `inventory/route.tsx` (the Task 1 pattern from Plan 05).
- `api/keys.ts`: the measured roots `inventory-stock`, `stock`, `stock-history`,
  `receipts`, `receipt`, `transfers`, `transfer`, `counts`, `count`, `thresholds` — **spelled
  exactly as today**, because the dialogs invalidate them by name.
- `api/inventory.ts`, `api/transfers.ts`, `api/counts.ts` take the three `api` groups
  (inventory 442–501, transfers 595–632, counts 633–650 in `lib/api.ts`).
- `types/`: the stock, receipt, transfer, and count blocks of `lib/api-types.ts` (lines ~398–649):
  `StockRow`, `StockDetail`, `StockListQuery`, `MovementRow`, `MovementListQuery`,
  `InventoryReceipt`, `InventoryReceiptLine`, `ReceiptCreateInput`, `ReceiptListQuery`,
  `AdjustmentReason`, `AdjustmentCreateInput`, `StockMovementType`, `StockThreshold`,
  `ThresholdInput`, `Transfer*`, `StockCount*`, `CountCreateInput`, `CountListQuery`.
- `utils/`: the stock-level tone/chip helpers and any transfer/count status mapping that is
  currently inline.

**Verify:** `bun run --filter admin check-types` passes with the pages still importing the old
symbols through a temporary re-export from `lib/api-types.ts`; no screen has changed yet.

**Commit:** `refactor(admin): add the inventory module api and types`

## Task 2 — Stock screens

**Files:** `pages/stock-page.tsx`, `pages/stock-detail-page.tsx`,
`components/{stock-table,adjust-dialog,receive-dialog,threshold-dialog}.tsx`,
routes `inventory/stock.tsx`, `inventory/stock/index.tsx`, `inventory/stock/$productId.tsx`

- Move `adjust-dialog`, `receive-dialog`, `threshold-dialog` from `components/inventory/`;
  `receive-dialog` and `supplier-picker` now import the **common** supplier combobox (Plan 02).
- Preserve: the low-stock filter, the search debounce, movement history pagination, the
  adjust-reason requirement, and the "warehouse vs retail" wording.
- Thresholds are per branch and admin-manager-scoped; the dialog's permission gate must not
  move into the module in a way that changes who sees it.

**Verify:** list stock, filter low, open a product's movement history, adjust (reason required),
receive with a supplier invoice number, set a threshold; the stock ledger's newest movement
appears immediately (same invalidation roots).

**Commit:** `refactor(admin): move the stock screens into the inventory module`

## Task 3 — Receipts

**Files:** `pages/receipts-page.tsx`, `pages/receipt-detail-page.tsx`,
`components/receipt-table.tsx`, routes `inventory/receipts/index.tsx`,
`inventory/receipts/$receiptId.tsx`

- The receipt detail still renders the linked payable's status. Until Plan 11 this stays
  `#/components/payables/invoice-status-badge` — **record it as the one known legacy edge** with
  a `TODO(phase-8/11)` comment naming the plan that flips it to `#/modules/payables`.
- Preserve the GRN sequence display and the line/quantity totals.

**Verify:** receipts list paginates; a receipt whose invoice is unpaid shows the same badge as
before; the TODO comment is present and the gate's legacy-domain list still excludes `payables`.

**Commit:** `refactor(admin): move the goods-receipt screens into the inventory module`

## Task 4 — Transfers

**Files:** `pages/transfers-page.tsx`, `pages/transfer-new-page.tsx`,
`pages/transfer-detail-page.tsx`, `components/{transfer-table,transfer-status-badge,transfer-lines-editor,transfer-quantity-dialog,edit-transfer-dialog,short-close-dialog}.tsx`,
routes `inventory/transfers/{index,new,$transferId}.tsx`

- Preserve the full lifecycle UI: draft → dispatch → receive → short-close, the short-close
  discrepancy entry, and the direction-filtered list.
- Side-scoped authority (source vs destination) is server-side; the UI must keep showing the
  same buttons to the same roles. Do not centralise the two `canX` checks into a new helper in
  this plan — that is a behaviour risk, not a move.

**Verify:** create a transfer, dispatch it, receive it partially, short-close it; the status
badge follows on each screen; a warehouse→branch transfer still renders read-only for a manager
who is not the source.

**Commit:** `refactor(admin): move the transfer screens into the inventory module`

## Task 5 — Counts

**Files:** `pages/counts-page.tsx`, `pages/count-new-page.tsx`, `pages/count-detail-page.tsx`,
`components/count-status-badge.tsx` (moved), routes `inventory/counts/{index,new,$countId}.tsx`

- The count detail (372 lines) is the largest remaining body: extract the entry grid into
  `components/count-entry-grid.tsx` only if it already exists as a self-contained block;
  otherwise move it verbatim and extract nothing.
- Preserve: opening a count snapshots, posting writes variance movements only, cancel, and the
  API's negative-guard message naming offending products.

**Verify:** open a count, enter quantities, post it, cancel another one; the stock projection on
the stock screen reflects the posted variance.

**Commit:** `refactor(admin): move the stock-count screens into the inventory module`

## Task 6 — Clear the name and close the cycle check

**Files:** `scripts/check-modules.mjs` (**controller-owned**), `admin/biome.json`,
`admin/src/components/inventory/` (deleted)

- Remove `inventory` from `PENDING_MODULES`; extend the legacy group with
  `#/components/inventory/**`.
- `supplier-picker` stays (it is inventory's own); confirm `product-picker` is gone from the
  directory (moved to `common` in Plan 02).

**Verify:** `bun run modules:check` passes with eight modules migrated and one documented legacy
edge; `bun run lint`, `bun run check-types`, `bun run --filter admin build` green; root
`bun run test` unchanged; append to `evidence/suites.txt`.

**Commit:** `chore(admin): record inventory as migrated`

## Definition of Done

- Twelve routes are thin; 2,222 route lines and eleven components live in one module.
- The stock ledger's write path is untouched: this plan moves screens only, and the API's
  append-only guarantees are not in scope.
- The one remaining `#/components/payables` import is explicitly scheduled to Plan 11.
- Every dialogs' invalidation still hits the same key root.
