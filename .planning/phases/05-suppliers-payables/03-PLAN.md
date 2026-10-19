---
phase: 05-suppliers-payables
plan: 03
wave: 3
title: Payables module — invoices from receipts and standalone, totals, voids
requirements: [SUP-03]
depends_on: [01, 02]
status: planned
created: 2026-10-19
---

# Plan 03 — Payables: Supplier Invoices

**Goal:** A supplier invoice — pre-filled from a goods receipt or entered standalone —
records the debt, links to its receipt, computes its totals and Ghana input-tax split
server-side, refuses duplicates, and can be voided while untouched.

## Task 1 — Inventory seam: supplier link and receipt loader

**Files:** `api/src/modules/inventory/inventory.types.ts`,
`api/src/modules/inventory/inventory.validation.ts`,
`api/src/modules/inventory/inventory.service.ts`,
`api/src/modules/inventory/inventory.repository.ts`,
`api/src/modules/inventory/inventory.api.test.ts`

- `ReceiptCreateInput` gains `supplierId?: string`; `StockReceiptRow`/`ReceiptDetail`
  gain `supplierId: string | null`. Validation: optional `z.uuid()`.
- `createReceipt`: when `supplierId` is present, resolve it through
  `suppliers.service.requireSupplier` (404/409 archived) and snapshot
  `supplierName = supplier.name` in the same transaction; free-text `supplierName`
  stays supported when no supplier is chosen.
- Repository: `insertReceipt` accepts `supplierId`; `findReceiptBase` and
  `selectReceiptPage` return it (join supplier name when present so history renders
  without a second call).
- New service seam `loadReceiptForPayables(receiptId, executor?)` returning
  `{ id, number, branchId, supplierId, supplierName, supplierInvoiceNumber, note, lines }`
  with **no permission checks** — authorization belongs to the payables service
  (service-to-service pattern; mirrors `requireCustomer`). Add its sibling
  `attachReceiptSupplier(receiptId, supplierId, executor)` (sets `supplier_id` and, when
  empty, the `supplier_name` snapshot; no-op when already set) for the invoice-from-
  receipt flow.
- Tests: receipt with `supplierId` stores both id and snapshot name; archived supplier
  → 409; invalid supplier → 404; receipt read back carries `supplierId`.

**Verify:** `bun run --filter api test` green.
**Commit:** `feat(api): link goods receipts to suppliers`

## Task 2 — Payables repository and types

**Files:** `api/src/modules/payables/payables.repository.ts`,
`api/src/modules/payables/payables.types.ts`

- Invoice: `insertInvoice`, `insertInvoiceLine`, `findInvoiceById`,
  `findInvoiceByReceipt(receiptId)`, `findInvoiceBySupplierNumber(supplierId, branchId,
  supplierInvoiceNumber)`, `lockInvoiceForUpdate(id, executor)`,
  `lockInvoicesForUpdate(ids, executor)` (sorted `in` + `FOR UPDATE`),
  `setInvoiceAmountPaid(id, amountPaidMinor, status, executor)`, `voidInvoiceRow`,
  `selectInvoicePage`, `countInvoices`, `selectInvoiceLines`, `selectInvoiceByIdempotency`.
- Invoice list query: supplier, branch, status, `overdue` (status in OPEN/PARTIAL and
  `due_date < asOf`), `from`/`to` on `invoiceDate`, `limit`/`offset`; ordered
  `invoiceDate desc, number desc`.
- Payment/allocation (used in Plan 04 but typed here):
  `insertPayment`, `insertAllocation`, `findPaymentById`, `selectPaymentsByInvoice`,
  `selectAllocationsByInvoice` (with payment number/method/status/paidAt),
  `sumAllocationsForInvoice(invoiceId, executor)` (signed sum).
- Types: `SupplierInvoiceRow/Detail`, `SupplierInvoiceLineRow`, `InvoiceCreateInput`
  (`z.infer` aliases), `InvoiceListQuery`, `InvoiceListResult`.

**Verify:** `bun run --filter api check-types`.
**Commit:** `feat(api): add payables repository and types`

## Task 3 — Invoice creation (from receipt or standalone)

**Files:** `api/src/modules/payables/payables.service.ts`,
`api/src/modules/payables/payables.validation.ts`,
`api/src/modules/payables/payables.test.ts`

- `createInvoice(user, actor, input)`:
  1. Resolve the branch: `input.branchId` or the manager's own branch; `assertBranchAccess`;
     branch must be active (`branchesService.getBranch` pattern).
  2. `suppliers.service.requireSupplier(supplierId)` (404/409 archived).
  3. Lines: 1–100; each line has `productId` xor `description`; `quantity` integer ≥ 1,
     `unitCostMinor` integer ≥ 0; products must exist and be active; duplicate products in
     one invoice → 400. `lineTotalMinor = quantity × unitCostMinor` server-side.
  4. Receipt link (optional): `loadReceiptForPayables`; receipt branch must equal the
     invoice branch; receipt must not already be invoiced (pre-check + the partial unique
     index); when the receipt has a `supplierId` it must equal the invoice's supplier.
     When created from a receipt with `copyFromReceipt: true`, the service builds the
     lines from the receipt's lines (product, quantity, cost) unless lines are supplied.
  5. Tax: the line sum (`lineTotalMinor = quantity × unitCostMinor`) is the recorded,
     tax-inclusive cost unless the operator supplies explicit tax values. When
     `vatMinor`/`nhilMinor`/`getfundMinor` are omitted, derive
     `breakdown = taxBreakdown(lineSum, 'STANDARD', 'INCLUSIVE')` from `@gikautos/shared`
     and store `subtotalMinor = breakdown.baseMinor`, the three components, and
     `totalMinor = breakdown.totalMinor` — so `subtotal + vat + nhil + getfund` equals the
     recorded line sum (and the receipt total) exactly. When the tax fields are provided
     (including zeroed tax for non-registered suppliers), lines are treated as net:
     `subtotalMinor = lineSum` and
     `totalMinor = subtotalMinor + vatMinor + nhilMinor + getfundMinor`. Totals are always
     recomputed server-side; never trust client totals.
  6. `invoiceDate` required (ISO date); `dueDate` defaults to `invoiceDate + supplier
     paymentTermDays` (0 = same day) and is editable; `dueDate ≥ invoiceDate` validated.
  7. Duplicate supplier invoice number for the supplier+branch (non-VOID) → 409 with
     `{ existingInvoiceId, number }` so the console links to the double entry.
  8. Transaction: allocate `SINV-#####` (`payable.invoiceSequence`) → lock the supplier
     row `FOR UPDATE` (serializes against archive) → insert header + lines → set the
     receipt's supplier snapshot when missing through
     `inventory.service.attachReceiptSupplier(receiptId, supplierId, executor)`
     (a new seam added in Task 1 alongside `loadReceiptForPayables`) →
     `suppliers.service.recordInvoiceCosts` → audit `supplier_invoice.created`
     (lines, split, link) → return the loaded detail.
  9. Idempotency: `(branchId, idempotencyKey)` pre-check + unique-violation replay inside
     the transaction (Phase 4 D23); replays return the existing invoice with
     `replayed: true`.
- `voidInvoice(user, actor, id, reason)`: lock the invoice; `sumAllocationsForInvoice`
  must be 0 (409 otherwise, telling the operator to void the payments first); set VOID +
  reason + `voidedBy`/`voidedAt`; audit `supplier_invoice.voided`; the supplier invoice
  number becomes reusable (partial unique excludes VOID).
- `getInvoice(user, id)`: header + lines + supplier summary + linked receipt summary
  (`number`, `branchId`) + allocations with payment numbers/methods (Plan 04 fills the
  rows; empty now) — branch-scoped for managers.
- `listInvoices(user, query)`: `resolveBranchFilter`; filters supplier/status/overdue/
  date range; returns rows with `outstandingMinor = totalMinor - amountPaidMinor`.

**Verify:** tests: standalone invoice with custom tax; receipt-derived invoice whose
`subtotal + vat + nhil + getfund` equals the receipt total exactly; `copyFromReceipt`
builds lines; branch-mismatch receipt 409; already-invoiced receipt 409; duplicate
supplier number 409 returns the existing id; idempotent replay returns one row
(parallel same-key race too); void with allocations 409; void then re-entry of the same
supplier number succeeds; manager cannot invoice another branch (403).

**Commit:** `feat(api): add supplier invoice creation and reads`

## Task 4 — Routes, validation, and wiring

**Files:** `api/src/modules/payables/payables.routes.ts`,
`api/src/modules/payables/payables.validation.ts`,
`api/src/modules/payables/payables.controller.ts`, `api/src/app.ts`

- Routes: `GET /api/payables/invoices` (`payable.read`), `POST /api/payables/invoices`
  (`payable.invoice.manage`), `GET /api/payables/invoices/:id` (`payable.read`),
  `POST /api/payables/invoices/:id/void` (`payable.void`).
- Zod: strict invoice body (`supplierId` uuid, `supplierInvoiceNumber` 1–60 trimmed,
  dates `z.iso.date()`, lines array 1–100 with `productId?`/`description?`,
  `quantity` int ≥ 1, `unitCostMinor` int ≥ 0, tax fields int ≥ 0 optional,
  `idempotencyKey` 1–120 optional, `copyFromReceipt` boolean optional, `receiptId` uuid
  optional, `note` ≤ 500).
- Wire `payablesRoutes` in `app.ts`; controller thin; integration tests assert the
  permission matrix (cashier 403, manager ok branch-scoped) and validation 400s.

**Verify:** `bun run --filter api test`; `bun run --filter api check-types`;
`bun run lint`.
**Commit:** `feat(api): expose supplier invoice routes`

## Done When

Invoices can be recorded from a goods receipt (linked both ways, totals matching the
receipt) or standalone (services/freight); the Ghana input-tax split is derived or
entered and always reconciles to the server-computed total; duplicate supplier invoice
numbers and double-invoicing a receipt are impossible; invoices void only when
untouched; every write is audited, idempotent, and branch-scoped.
