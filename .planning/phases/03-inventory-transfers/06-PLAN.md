---
phase: 03-inventory-transfers
plan: 06
wave: 6
title: Console — inventory shell, stock screens, receive, adjust, thresholds
requirements: [ADM-04, INV-03, INV-04, INV-07, INV-08]
depends_on: [03]
status: planned
created: 2026-10-18
---

# Plan 06 — Console Inventory: Stock, Receive, Adjust, Thresholds

**Goal:** Admins and managers browse stock with branch-aware levels, see any product's
movement history, receive goods with a supplier reference, adjust with reasons, and manage
low-stock thresholds — all through the existing dense neutral console patterns.

## Task 1 — API client types/functions and inventory shell

**Files:** `admin/src/lib/api-types.ts`, `admin/src/lib/api.ts`,
`admin/src/components/layout/sidebar.tsx`,
`admin/src/routes/_authenticated/inventory/route.tsx`,
`admin/src/routes/_authenticated/inventory/index.tsx`

- Types + `api.inventory`: stock list/detail, movements, low stock, thresholds
  (list/upsert/remove), receipts (create/list/get), adjustments (create) mirroring the
  verified Plan 03 contracts (hand-maintained, same style as catalog).
- Sidebar "Inventory" item (`inventory.read`) after Catalog; `/inventory` layout with
  tabs Stock / Transfers / Counts (transfers/counts panes land in Plan 07 but the layout
  ships now with the Stock tab); `/inventory` redirects to `/inventory/stock`.
- Tab visibility gated by `hasPermission` (Stock/Transfers/Counts all require
  `inventory.read`; action buttons inside each screen carry the specific permission).

**Verify:** `bun run --filter admin check-types`; manager sees Inventory, cashier never
reaches the console.
**Commit:** `feat(admin): add inventory api client and navigation shell`

## Task 2 — Stock screens

**Files:** `admin/src/routes/_authenticated/inventory/stock.tsx`,
`admin/src/routes/_authenticated/inventory/stock.$productId.tsx`,
`admin/src/components/inventory/product-picker.tsx`

- Stock list: branch context banner from the existing switcher (managers fixed to own
  branch); debounced search (name/SKU via API `q`); "Low stock only" toggle; columns
  SKU (mono), name, category, on-hand (tabular numerals), average cost, stock value
  (`formatGhs`), threshold, low badge; `Pagination`; empty/loading/error states; row
  click → detail.
- Stock detail (`/inventory/stock/:productId`): product summary (SKU, name, category,
  tax category); branch level card (on-hand, average cost, value, last movement time);
  threshold editor dialog (set/remove, `inventory.threshold`); movement history table
  (paginated, newest first): date, type badge, reference number, reason, signed qty
  (green/red), unit cost, actor; manual refresh button.
- `product-picker.tsx`: reusable debounced product search combobox (uses
  `GET /api/products?q=`), shows SKU + name + on-hand at the active branch, used by
  receive/adjust/transfer/count screens.

**Verify:** list and detail render against the running API; manager sees only own branch;
search finds a demo product; history shows the seeded opening receipts.
**Commit:** `feat(admin): add stock list and product stock detail screens`

## Task 3 — Receive, adjust, and threshold dialogs

**Files:** `admin/src/components/inventory/receive-dialog.tsx`,
`admin/src/components/inventory/adjust-dialog.tsx`,
`admin/src/components/inventory/threshold-dialog.tsx`,
`admin/src/routes/_authenticated/inventory/stock.tsx`

- Receive dialog (multi-line): rows of product picker + quantity + unit cost (defaults to
  product cost price when picked), add/remove rows, running total; supplier name and
  supplier invoice number inputs (optional); note; submit → success toast with the GRN
  number, `['inventory-stock']`/`['inventory-movements']` invalidation; validation errors
  inline; double-submit guarded by disabled state.
- Adjust dialog (single line): product picker, direction (+/−) with quantity, reason
  select (D14 enums with human labels), note; shows resulting level preview; 409 negative
  errors surfaced verbatim.
- Threshold dialog: set/update/remove threshold for the selected product+branch.
- All permission-gated (`inventory.receive`, `inventory.adjust`, `inventory.threshold`);
  toasts via `toastApiError`.

**Verify:** receive raises on-hand and history shows the GRN; adjust posts a reason-coded
movement; over-adjust shows the 409 message; threshold change reflects on the low-stock
filter.
**Commit:** `feat(admin): add receive, adjust, and threshold dialogs`

## Done When

Stock is browsable per branch with correct values, history is traceable per product, and
receiving, adjusting, and thresholds work end to end from the console with audit-visible
effects.
