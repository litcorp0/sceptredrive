---
phase: 08-admin-modules-shell
plan: 11
wave: 11
title: Payables module — invoices, payments, aging
requirements: [UIX-06]
depends_on: [10]
status: planned
created: 2026-10-24
---

# Plan 11 — `modules/payables`

**Goal:** The last screen domain, and the point at which the import graph becomes acyclic and
`#/components/<domain>` disappears from the console entirely.

Six routes (1,585 lines) live under `/suppliers/…` and belong to `payables` (research F8):
invoices list 320, invoice new 17, invoice detail 306, payments list 322, payment detail 199,
aging 159.

## Task 1 — API, keys, types

**Files:** new `admin/src/modules/payables/{api,types,utils}`; `lib/api.ts`; `lib/api-types.ts`

- `api/keys.ts`: `payablesKeys` with `invoices`, `invoice`, `payments`, `payment`,
  `payables-aging`, `payables-summary` — the measured roots.
- `api/payables.ts` takes the `api.payables` group verbatim (lines 554–594 of `lib/api.ts`),
  including create-from-receipt, standalone create, void invoice, payment create/void, and the
  aging query.
- `types/`: `Invoice`, `InvoiceLine`, `InvoiceCreateInput`, `InvoiceListQuery`, `InvoiceVoidInput`,
  `Payment`, `PaymentCreateInput`, `PaymentListQuery`, `PaymentListResult`, `PaymentVoidInput`,
  `Allocation`, `InvoiceStatus`, `PaymentMethod`, `PayablesAgingQuery`, `PayablesAgingResult`.
- `utils/`: invoice/payment status label + tone maps (currently inline), and the allocation
  arithmetic **only if it is already display-only**. Any settling logic stays on the server —
  the console must not compute a balance the API already reports.

**Verify:** `grep -rn "api.payables" admin/src` returns nothing; an invoice and a payment still
render the same status badges and the same masked figures.

**Commit:** `refactor(admin): add the payables module api and types`

## Task 2 — Components

**Files:** `modules/payables/components/{invoice-status-badge,payment-method-badge,invoice-form,invoice-lines-editor,allocation-editor,payment-form-dialog,void-invoice-dialog,void-payment-dialog,aging-table,payables-summary-cards}.tsx`
(moved from `components/payables/`)

- Move all ten verbatim. `invoice-lines-editor` and `payment-form-dialog` now use the **common**
  product picker and supplier combobox (Plan 02) — no `inventory` or `suppliers` import remains.
- Preserve: allocation must never exceed the invoice balance (the dialog's guard), voiding
  requires a reason, and payment methods render the same labels.

**Verify:** `grep -rn "#/components/inventory\|#/components/suppliers" admin/src/modules/payables`
returns nothing; the invoice form adds lines with the common product picker.

**Commit:** `refactor(admin): move the payables components into the payables module`

## Task 3 — Pages

**Files:** `modules/payables/pages/{invoices-page,invoice-new-page,invoice-detail-page,payments-page,payment-detail-page,payables-aging-page}.tsx`,
routes `_authenticated/suppliers/invoices/{index,new,$invoiceId}.tsx`,
`_authenticated/suppliers/payments/{index,$paymentId}.tsx`,
`_authenticated/suppliers/aging.tsx`, `index.ts`

- Extract each route body. `invoices/new` was 17 lines (it only renders `invoice-form`) — prove
  it collapses to a page that renders the component.
- Keep `validateSearch` on the invoice and payment list routes (they have one today).
- Preserve: create-from-receipt linking, aging buckets per supplier and branch, the summary
  cards, void dialogs, and the admin/manager scoping of the aging query (`branchId` required for
  an admin).
- The supplier detail page's tabs must still land here; nothing about the URL changes.

**Verify:** create a standalone invoice with two lines, match one to a goods receipt, record a
partial payment allocated to the invoice, void the payment, void the invoice; the aging report
reconciles to invoices minus payments for the demo supplier; `bun run modules:check` passes with
thirteen modules migrated.

**Commit:** `refactor(admin): move the payables screens into the payables module`

## Task 4 — Flip the last two legacy edges

**Files:** `admin/src/routes/_authenticated/inventory/receipts/$receiptId.tsx` (import only),
the supplier pages carrying `TODO(phase-8/11)` comments (imports only),
`admin/src/components/payables/` (deleted), `scripts/check-modules.mjs`
(**controller-owned**), `admin/biome.json`

- Replace every `#/components/payables/…` import with the barrel `#/modules/payables` and remove
  the TODO comments. The recorded count from Plan 10 must reach **zero**.
- `inventory/receipts/$receiptId.tsx` now imports `#/modules/payables` — the one honest
  cross-domain edge in the console. Confirm no payables file imports `inventory` (Plan 02 removed
  the only one), so the graph stays acyclic.
- Delete `components/payables/`, add `#/components/payables/**` to the legacy group, and remove
  `payables` from `PENDING_MODULES`.

**Verify:** `grep -rn "#/components/" admin/src | grep -v "components/ui\|components/common\|components/layout"` returns **nothing**; the receipt detail still shows its invoice badge;
`bun run modules:check` passes; `bun run lint`, `bun run check-types`,
`bun run --filter admin build` green; root `bun run test` unchanged; append to
`evidence/suites.txt`.

**Commit:** `refactor(admin): retire the last domain component folder`

## Definition of Done

- All 64 domain components have moved; only `components/{ui,common,layout}` remain.
- `#/components/<domain>` appears nowhere in the console source.
- Payables owns six pages under a URL that says `suppliers` — the clearest demonstration that a
  route file only routes.
- No console code computes a payable balance the API already returns.
