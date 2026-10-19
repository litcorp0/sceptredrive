---
phase: 05-suppliers-payables
plan: 06
wave: 6
title: Console — invoices, payments, aging, and goods-receipt linking
requirements: [SUP-03, SUP-04, SUP-05, ADM-06]
depends_on: [03, 04, 05]
status: planned
created: 2026-10-19
---

# Plan 06 — Console Payables and Receipt Linking

**Goal:** The console can record a supplier invoice (standalone or pre-filled from a
goods receipt), see its lines, tax split, and allocations, record and void payments with
explicit allocation or an on-account remainder, review balances and aging — and the
inventory side gains a Receipts tab whose detail offers "Record supplier invoice".

## Task 1 — API client additions

**Files:** `admin/src/lib/api-types.ts`, `admin/src/lib/api.ts`

- Types: `SupplierInvoice`, `SupplierInvoiceDetail`, `SupplierInvoiceListQuery/Result`,
  `SupplierInvoiceLine`, `InvoiceCreateInput`, `SupplierPayment`,
  `SupplierPaymentDetail`, `PaymentCreateInput`, `PaymentAllocation`, `SupplierBalance`,
  `PayablesAging`, `AgingQuery`, `InvoiceVoidInput`, `PaymentVoidInput`,
  `InventoryReceipt`/`ReceiptDetail` (list lazily fills what Phase 3 left unused).
- `api.payables`: `invoices.list/get/create/void`, `payments.list/get/create/void`,
  `balances.list`, `aging.get`. `api.inventory.receipts`: `list`, `get` (endpoints
  already exist).
- Money helpers: reuse `formatGhs`/`parseGhsToMinor`; no floats.

**Verify:** `bun run --filter admin check-types`.
**Commit:** `feat(admin): add payables API client`

## Task 2 — Invoices: list, form (standalone and from receipt), detail, void

**Files:** `admin/src/routes/_authenticated/suppliers/invoices/index.tsx`,
`admin/src/routes/_authenticated/suppliers/invoices/new.tsx`,
`admin/src/routes/_authenticated/suppliers/invoices/$invoiceId.tsx`,
`admin/src/components/payables/invoice-lines-editor.tsx`,
`admin/src/components/payables/invoice-form.tsx`,
`admin/src/components/payables/invoice-status-badge.tsx`,
`admin/src/components/payables/void-invoice-dialog.tsx`

- List: filters (supplier combobox, status, branch for admin, date range, overdue
  toggle), columns (internal number, supplier, supplier invoice number, branch, dates,
  total, paid, outstanding, status badge with overdue tint); `New invoice` gated on
  `payable.invoice.manage`; rows link to detail; `?supplierId=` search param honoured.
- Form page (`new.tsx`): optional goods-receipt picker (searchable list of the branch's
  receipts without a linked invoice, loaded via `api.inventory.receipts.list`,
  `?receiptId=` search param pre-selects); supplier combobox (pre-selected from the
  receipt's supplier or name match); supplier invoice number; invoice/due dates (due
  pre-filled from the supplier's terms when a supplier is chosen, labelled "terms: N
  days"); lines editor (product picker reuse + free-text description lines, quantity,
  unit cost, live line totals); tax panel: "Standard 20% (derived)" default showing the
  computed VAT/NHIL/GETFund split of the subtotal, "No tax", or "Manual" three fields
  (all via the shared engine shape — client mirrors, server recomputes); totals summary
  (subtotal, tax split, total); note.
  - When opened from a receipt, lines pre-fill from the receipt and the totals must
    equal the receipt total by construction; a read-only chip links back to the receipt.
  - Submit keeps one idempotency key per form session (kept on network failure, cleared
    on any API response — Phase 4 pattern); 409s (duplicate supplier number with link to
    the existing invoice, already-invoiced receipt, archived supplier) render inline.
- Detail: header (numbers, dates, status, supplier link), lines table with product/
  description, quantity, unit cost, line total, footer with subtotal and tax split;
  linked receipt card linking to the inventory receipt screen; allocations table
  (payment number, method, date, amount applied, releases shown as negative history);
  `Record payment` button (Task 3 dialog pre-scoped to this invoice); `Void` action
  gated on `payable.void` with reason select, disabled/explained when allocations exist
  (server 409 rendered readably).

**Verify:** check-types + build; manual browser pass of both creation paths and the void
guard.
**Commit:** `feat(admin): add supplier invoice screens`

## Task 3 — Payments: list, record with allocations, detail, void

**Files:** `admin/src/routes/_authenticated/suppliers/payments/index.tsx`,
`admin/src/routes/_authenticated/suppliers/payments/$paymentId.tsx`,
`admin/src/components/payables/payment-form-dialog.tsx`,
`admin/src/components/payables/allocation-editor.tsx`,
`admin/src/components/payables/payment-method-badge.tsx`,
`admin/src/components/payables/void-payment-dialog.tsx`

- List: filters (supplier, method, status, date range, branch for admin), columns
  (number, supplier, branch, method, paid-at, amount, allocated, on-account, status);
  `Record payment` gated on `payable.payment`.
- `payment-form-dialog.tsx`: supplier combobox; method select (CASH/BANK/MOMO) with
  optional payment-detail picker (the supplier's active details, filtered by method);
  amount; paid-at; reference; note.
- `allocation-editor.tsx`: lists the supplier's outstanding invoices (number, supplier
  invoice number, due date, days overdue, outstanding) with an amount input per row and
  an "Allocate oldest first" action; enforces `amount per invoice ≤ outstanding` and
  Σ ≤ payment amount client-side (server re-checks); shows the running unallocated
  remainder labelled "On account".
- Detail: header, allocation history with APPLY/RELEASE rows and the running net,
  linked invoices, void action (reason dialog listing the releases that will be
  written); re-voiding impossible (status VOID).
- One idempotency key per payment form session, as above.

**Verify:** check-types + build; manual browser pass: partial, multi-invoice, remainder,
void (check the invoice flips back).
**Commit:** `feat(admin): add supplier payment screens`

## Task 4 — Balances and aging view

**Files:** `admin/src/routes/_authenticated/suppliers/aging.tsx`,
`admin/src/components/payables/aging-table.tsx`,
`admin/src/components/payables/payables-summary-cards.tsx`

- Aging page: as-of date (default today), branch selector (admin only), supplier filter
  optional; headline cards (total owed, overdue, on account, invoices open); table per
  supplier with Current / 1–30 / 31–60 / 61–90 / 90+ columns, on-account column, total
  owed, and a totals row; zero buckets muted (Phase 4 aging table styling); supplier
  rows link to the supplier's invoices (`?supplierId=`) and detail.
- Balances list feeds the supplier list's owed column when `payable.read` is held.

**Verify:** check-types + build; manual pass with seeded data and an as-of date in the
past.
**Commit:** `feat(admin): add payables aging and balances`

## Task 5 — Inventory receipts tab, receipt detail, and receive-dialog supplier picker

**Files:** `admin/src/routes/_authenticated/inventory/route.tsx`,
`admin/src/routes/_authenticated/inventory/receipts/index.tsx`,
`admin/src/routes/_authenticated/inventory/receipts/$receiptId.tsx`,
`admin/src/components/inventory/receive-dialog.tsx`,
`admin/src/components/inventory/supplier-picker.tsx`

- `inventory/route.tsx`: add the **Receipts** tab (`/inventory/receipts`) between Stock
  and Transfers.
- Receipts list: columns (number, branch for admins, supplier name, supplier invoice
  number, lines, total cost, received by/at), date-range filter, `Receive stock` button
  opening the existing dialog.
- Receipt detail: header card (number, branch, supplier with link when the receipt has a
  `supplierId`, free-text supplier otherwise, supplier invoice number, note, created
  by/at), lines table (SKU, product, quantity, unit cost, line total), footer total;
  linked supplier invoice card (number, status, total, link to the invoice screen) or
  a `Record supplier invoice` button (gated on `payable.invoice.manage`) navigating to
  `/suppliers/invoices/new?receiptId=…`.
- `supplier-picker.tsx`: searchable combobox of active suppliers (`supplier.read`)
  with a "Not listed — type a name" escape hatch that sets the free-text
  `supplierName`; wire into `receive-dialog.tsx` above the existing invoice-number
  field.

**Verify:** check-types + build; manual browser pass: receive with a supplier, open the
receipt, record the invoice, see the link on both screens; receive with a free-text name
still works.
**Commit:** `feat(admin): add goods receipt screens and supplier picker`

## Done When

The console tells the whole AP story: receive goods with a supplier, record the invoice
from the receipt (or standalone), settle it in full or part with explicit allocations,
void mistakes with history intact, and read balances and aging that match the API rows —
with permission-aware actions throughout.
