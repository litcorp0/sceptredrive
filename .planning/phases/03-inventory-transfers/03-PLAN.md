---
phase: 03-inventory-transfers
plan: 03
wave: 3
title: Inventory APIs — receipts, adjustments, stock, history, low stock, thresholds
requirements: [INV-02, INV-03, INV-04, INV-07, INV-08]
depends_on: [02]
status: planned
created: 2026-10-18
---

# Plan 03 — Inventory Module APIs

**Goal:** The console can receive stock (with supplier reference), adjust with reasons,
browse stock and movement history, and manage low-stock thresholds — all branch-scoped,
audited, and validated.

## Task 1 — Goods receipts

**Files:** `api/src/modules/inventory/inventory.routes.ts`,
`inventory.validation.ts`, `inventory.controller.ts`, `inventory.service.ts`,
`inventory.repository.ts`, `inventory.types.ts` (schema from Plan 01), `api/src/app.ts`

- Zod: `POST /api/inventory/receipts` — `{ branchId, supplierName? (≤120),
  supplierInvoiceNumber? (≤60), note? (≤300), lines: [{ productId, quantity (int ≥1),
  unitCostMinor (int ≥0) }] (1–100, unique productId) }`; query/list schemas with
  `branchId` (admin) / forced manager scope, date range, pagination.
- Service `createReceipt(user, actor, input)`: `assertBranchAccess`; validate every
  product exists and is active (404/409); allocate `GRN-#####` via
  `allocateFromSequence('inventory.receiptSequence')`; in one transaction: insert
  `stock_receipt` + lines, call `postMovements` (type `RECEIPT`, `referenceNumber` = GRN),
  audit `stock_receipt.created` with lines and total cost; return the receipt with lines.
- `GET /api/inventory/receipts` (branch-scoped, paginated) and
  `GET /api/inventory/receipts/:id` (with lines). Receipts are immutable: no PATCH/DELETE.
  Register routes in `api/src/app.ts`.

**Verify:** integration tests: receipt raises on-hand and blends average; GRN numbers
increment; supplier fields stored; unknown/inactive product 404/409; duplicate product
line 400; manager other branch 403; audit row with lines; no payable table touched.
**Commit:** `feat(api): add goods receipt endpoints with supplier reference`

## Task 2 — Adjustments and movement history

**Files:** inventory module files, `api/src/app.ts`

- `POST /api/inventory/adjustments` — `{ branchId, productId, quantityDelta (int ≠0),
  reasonCode (enum D14), note? (≤300) }`; service validates product active, posts one
  `ADJUSTMENT` movement via `postMovements` (average unchanged; `unitCostMinor` = current
  average), audit `stock.adjusted` with before/after level and reason; 409 when the
  result would go negative.
- `GET /api/inventory/movements` — filters `branchId` (admin; manager forced), `productId?`,
  `type?`, `from?`/`to?` (ISO dates), `limit`/`offset`; returns movements ordered newest
  first with product name/sku, reference number, reason, note, actor, signed qty, unit
  cost; branch-scoped.
- `GET /api/inventory/levels/:productId` — level at a branch (for the detail screen).

**Verify:** tests: adjustment requires a reason (400 without), audit before/after, stamp
`unitCostMinor` equals current average, negative blocked, manager scoping (own branch
200, other 403), admin can filter any branch; movement history filters and pagination.
**Commit:** `feat(api): add stock adjustments and movement history endpoints`

## Task 3 — Stock list, low stock, and thresholds

**Files:** inventory module files, `api/src/app.ts`

- `GET /api/inventory/stock` — `branchId` (admin must pass; manager forced), `q`
  (name/SKU), `lowStock=true` filter, `limit`/`offset`; rows: product (sku, name,
  category), `quantityOnHand`, `avgCostMinor`, `valueMinor = qty × avg`, `threshold|null`,
  `isLow`; joins `stock_level` with product/category and left-joins threshold; ordered by
  name.
- `GET /api/inventory/low-stock` — same rows filtered to `on_hand <= threshold` for the
  scoped branch (admin may pass any branch).
- `GET /api/inventory/thresholds` (branch-scoped list), `PUT /api/inventory/thresholds`
  — `{ branchId, productId, threshold (int ≥0) }` upsert with audit `stock_threshold.updated`
  before/after, `DELETE /api/inventory/thresholds/:productId?branchId` — remove with
  audit; both `inventory.threshold`, managers own-branch only.

**Verify:** tests: stock list search + low filter + pagination + value math; thresholds
upsert/replace/remove with audit; low-stock boundary (equal counts as low); manager other
branch 403 on all three; archived products excluded from stock list.
**Commit:** `feat(api): add stock, low-stock, and threshold endpoints`

## Done When

Every INV read/write surface the console needs exists, is branch-scoped and permission-
checked, writes audit rows in-transaction, and reuses the single posting service.
