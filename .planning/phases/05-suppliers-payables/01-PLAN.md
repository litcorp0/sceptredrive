---
phase: 05-suppliers-payables
plan: 01
wave: 1
title: Phase 5 schema, receipt link, settings, permissions, and demo seed
requirements: [SUP-01, SUP-02, SUP-03, SUP-04, SUP-05, ADM-06]
depends_on: []
status: planned
created: 2026-10-19
---

# Plan 01 — Schema, Receipt Link, Settings, Permissions, Demo Seed

**Goal:** The supplier master, payment details, supplier products, invoices, invoice
lines, payments, and allocation tables exist with the right constraints and indexes;
`stock_receipt` links to a supplier; the three new sequences and six settings are
configured; the Phase 5 permissions exist in `@gikautos/shared`; the demo seed carries an
idempotent AP story that matches the existing demo receipts.

## Task 1 — Suppliers schema + migration

**Files:** `api/src/modules/suppliers/suppliers.schema.ts`, generated
`api/migrations/0005_*.sql` (+ `api/migrations/meta/`)

- `pgEnum('supplier_status', ['ACTIVE','ARCHIVED'])`;
  `pgEnum('supplier_payment_detail_method', ['BANK','MOMO'])`;
  `pgEnum('supplier_momo_network', ['MTN','VOD','ATL'])` (the Paystack Ghana telco
  codes, resolved research §2).
- `supplier`: uuid pk defaultRandom; `code` text notNull; `name` text notNull;
  `contactName` text; `phone` text (E.164, nullable); `email` text; `address` text;
  `tin` text; `vatNumber` text; `paymentTermDays` integer notNull default 0; `notes`
  text; `status` enum notNull default `ACTIVE`; `createdBy` text; timestamps with
  `$onUpdate`. Indexes: unique `supplier_code_unique` on `code`; index on `status`;
  trigram index `supplier_name_trgm_idx` on `name` `gin_trgm_ops` (append
  `CREATE INDEX …` to the generated migration, same pattern as 0004).
- `supplier_payment_detail`: uuid pk; `supplierId` fk supplier (restrict); `method`
  enum notNull; `label` text; `accountName` text; `accountNumber` text; `bankName`
  text; `bankCode` text; `momoNetwork` enum; `phone` text (E.164); `isDefault` boolean
  notNull default false; `isActive` boolean notNull default true;
  `paystackRecipientCode` text (Phase 8, unused now); `createdBy`; timestamps.
  Indexes: `(supplierId)`; unique `(supplierId, method, accountNumber)`; **partial
  unique** `supplier_payment_detail_default_unique` on `(supplierId)`
  `WHERE is_default AND is_active`.
- `supplier_product`: uuid pk; `supplierId` fk supplier (restrict); `productId` fk
  product (restrict); `supplierSku` text; `leadTimeDays` integer; `lastCostMinor`
  integer notNull default 0; `lastCostAt` timestamptz; `isPreferred` boolean notNull
  default false; `createdBy`; timestamps. Indexes: unique `(supplierId, productId)`;
  `(productId)`; **partial unique** `supplier_product_preferred_unique` on `(productId)`
  `WHERE is_preferred`.
- Generate with `bun run db:generate`; inspect the SQL; append the trigram index
  statement; then `bun run db:migrate` and `bun run db:test:prepare`.

**Verify:** migrations apply on the dev DB and the test DB; `\d supplier`,
`\d supplier_payment_detail`, `\d supplier_product` show the indexes and partial
uniques; inserting two active defaults for one supplier fails; `bun run --filter api
check-types`.
**Commit:** `feat(api): add supplier schema`

## Task 2 — Payables schema + `stock_receipt.supplier_id`

**Files:** `api/src/modules/payables/payables.schema.ts`,
`api/src/modules/inventory/inventory.schema.ts`, generated `api/migrations/0005_*.sql`

- Enums: `supplier_invoice_status` `['OPEN','PARTIAL','PAID','VOID']`;
  `supplier_invoice_void_reason` `['DUPLICATE','CANCELLED','ERROR','OTHER']`;
  `supplier_payment_method` `['CASH','BANK','MOMO']` (PAYSTACK arrives in Phase 8);
  `supplier_payment_status` `['COMPLETED','VOID']`;
  `supplier_payment_void_reason`
  `['DUPLICATE','ERROR','RETURNED','BANK_REVERSAL','OTHER']`;
  `supplier_allocation_kind` `['APPLY','RELEASE']`.
- `supplier_invoice`: uuid pk; `number` text notNull; `supplierId` fk supplier
  (restrict); `branchId` fk branch (restrict); `supplierInvoiceNumber` text notNull;
  `invoiceDate` date notNull; `dueDate` date notNull; `receiptId` uuid nullable fk
  stock_receipt (restrict); `subtotalMinor` integer notNull (≥ 0); `vatMinor`,
  `nhilMinor`, `getfundMinor` integer notNull default 0; `totalMinor` integer notNull;
  `amountPaidMinor` integer notNull default 0 (projection);
  `status` enum notNull default `OPEN`; `voidReason` enum; `voidedBy` text;
  `voidedAt` timestamptz; `note` text; `idempotencyKey` text; `createdBy` text;
  `createdAt` defaultNow; `updatedAt` `$onUpdate`. Indexes: unique `number`;
  unique `(branchId, idempotencyKey)`; **partial unique**
  `supplier_invoice_supplier_number_unique` on `(supplierId, branchId,
  supplierInvoiceNumber)` `WHERE status <> 'VOID'`; **partial unique**
  `supplier_invoice_receipt_unique` on `(receiptId)` `WHERE receipt_id IS NOT NULL`;
  `(branchId, status, dueDate)`; `(supplierId, status)`.
- `supplier_invoice_line`: uuid pk; `invoiceId` fk invoice (cascade); `productId` uuid
  nullable fk product (restrict); `description` text; `quantity` integer notNull;
  `unitCostMinor` integer notNull; `lineTotalMinor` integer notNull; `createdAt`.
  Indexes: `(invoiceId)`; **partial unique** on `(invoiceId, productId)`
  `WHERE product_id IS NOT NULL`; `(productId)`.
- `supplier_payment`: uuid pk; `number` text notNull; `supplierId` fk (restrict);
  `branchId` fk (restrict); `method` enum notNull; `amountMinor` integer notNull;
  `reference` text; `paidAt` timestamptz notNull; `paymentDetailId` uuid nullable fk
  supplier_payment_detail (restrict); `status` enum notNull default `COMPLETED`;
  `voidReason` enum; `voidedBy` text; `voidedAt` timestamptz; `note` text;
  `idempotencyKey` text; `createdBy` text; timestamps. Indexes: unique `number`;
  unique `(branchId, idempotencyKey)`; `(supplierId, paidAt)`;
  `(branchId, paidAt)`; `(status)`.
- `supplier_payment_allocation`: uuid pk; `paymentId` fk (restrict); `invoiceId` fk
  supplier_invoice (restrict); `kind` enum notNull; `amountMinor` integer notNull
  (signed, non-zero — APPLY positive, RELEASE negative); `reversesAllocationId` uuid
  nullable self-FK; `note` text; `createdBy`; `createdAt`. Indexes: `(paymentId)`,
  `(invoiceId)`, `(reversesAllocationId)`.
- `inventory.schema.ts`: add `supplierId` uuid nullable referencing
  `../suppliers/suppliers.schema.ts` `supplier.id` (restrict) on `stock_receipt`, plus
  an index `stock_receipt_supplier_idx`. Keep `supplierName` for free-text receipts and
  as the snapshot set when a supplier is chosen.
- Import cycle check: `suppliers.schema` → products/org only; `payables.schema` →
  suppliers/inventory/org; `inventory.schema` → suppliers. No cycle.

**Verify:** migration applies; `\d supplier_invoice` shows both partial uniques;
inserting a second non-VOID invoice with the same supplier+branch+number fails;
`stock_receipt.supplier_id` accepts null and a supplier id (FK enforced); full
`bun run db:test:prepare` + `bun run --filter api check-types`.
**Commit:** `feat(api): add payables schema and receipt supplier link`

## Task 3 — Phase 5 settings, prefixes, and sequences

**Files:** `api/src/modules/platform/settings.validation.ts`,
`api/src/modules/platform/settings.service.ts`,
`api/src/modules/platform/platform.test.ts`

- `SETTING_DEFINITIONS` additions (all global, admin-only per the existing rule):
  `supplier.codePrefix` (string 1–8 alnum, default `SUP`), `supplier.codeSequence`
  (int ≥ 1, default 1), `payable.invoicePrefix` (default `SINV`),
  `payable.invoiceSequence` (1), `payable.paymentPrefix` (default `PAY`),
  `payable.paymentSequence` (1).
- Extend `SequenceKey` with `supplier.codeSequence`, `payable.invoiceSequence`,
  `payable.paymentSequence` and `SEQUENCE_FORMATS` (pad 5; labels "supplier code",
  "supplier invoice number", "supplier payment number").
- Tests: allocation/peek/advance for each new sequence following the existing
  `SUP-00001`-style assertions (format-based, since suites share the test DB);
  manager update of a global Phase 5 setting → 403; invalid values rejected.

**Verify:** `bun run --filter api test` green after `db:test:prepare`;
`bun run --filter api check-types`.
**Commit:** `feat(api): add phase 5 settings and sequences`

## Task 4 — Shared permissions

**Files:** `packages/shared/src/permissions.ts`,
`packages/shared/src/permissions.test.ts`

- Add `supplier.read`, `supplier.create`, `supplier.update`, `supplier.archive`,
  `payable.read`, `payable.invoice.manage`, `payable.payment`, `payable.void`.
- `ROLE_PERMISSIONS`: ADMIN all; MANAGER `supplier.read`, `payable.read`,
  `payable.invoice.manage`, `payable.payment`, `payable.void`; CASHIER none.
- Update the permission matrix tests (admin/manager/cashier counts, no duplicates,
  manager cannot create/update/archive suppliers).

**Verify:** `bun run --filter shared test`; `bun run --filter api check-types` after the
permission ripple.

**Commit:** `feat(shared): add phase 5 permissions`

## Task 5 — Demo seed suppliers, mappings, invoices, payments

**Files:** `api/src/seed/helpers.ts`, `api/src/seed/demo.ts`

- Helpers (direct Drizzle in one transaction, idempotent by natural key; services do not
  exist during seeding):
  - `ensureSupplier({ code, name, contactName?, phone?, email?, address?, tin?,
    vatNumber?, paymentTermDays })` — lookup by code first.
  - `ensureSupplierPaymentDetail({ supplierId, method, accountName, accountNumber,
    bankName?, bankCode?, momoNetwork?, phone?, isDefault })` — lookup by
    `(supplierId, method, accountNumber)`.
  - `ensureSupplierProduct({ supplierId, productId, supplierSku, leadTimeDays?,
    lastCostMinor? , isPreferred? })`.
  - `ensureStockReceipt` gains an optional `supplierId`; add
    `linkReceiptSuppliers(map: Record<string, string>)` that sets `supplier_id` where
    `supplier_name` matches and `supplier_id IS NULL` (idempotent backfill of the two
    demo receipts).
  - `ensureSupplierInvoice({ number, supplierId, branchId, supplierInvoiceNumber,
    invoiceDate, dueDate, receiptId?, lines, tax: 'DERIVED' | 'NONE', note? })` —
    computes `subtotalMinor` by summing line totals and, when `DERIVED`, the split with
    `taxBreakdown(subtotal, 'STANDARD', 'INCLUSIVE')` from `@gikautos/shared`;
    `totalMinor = subtotal + tax`; inserts header + lines.
  - `ensureSupplierPayment({ number, supplierId, branchId, method, amountMinor,
    paidAt, reference?, allocations })` — inserts the payment plus APPLY rows and sets
    `amountPaidMinor`/`status` on the touched invoices.
- Demo data (all at ACC-SPX unless noted; matches the demo receipts from Phase 3):
  - `SUP-00001` "Accra Parts Depot" (bank `GCB` + MoMo MTN default, terms 30) and
    `SUP-00002` "GikAutos Imports" (MoMo default, terms 14); `linkReceiptSuppliers` maps
    GRN-00002 → SUP-00001 and GRN-00001 → SUP-00002.
  - Four `supplier_product` mappings across the demo products with supplier SKUs and
    last costs (one product marked `isPreferred`).
  - `SINV-00001` from GRN-00002 (`APD-0451`, due +30 days) with the derived 20% split;
    `PAY-00001` (MOMO) allocated 40% to it so it lands `PARTIAL`.
  - `SINV-00002` standalone (no receipt) with a description-only freight line, no tax,
    unpaid — proves the non-inventory path.
  - `PAY-00002` (BANK) allocated to nothing (on-account remainder) with a reference.
  - `ensureSequenceAtLeast` for `supplier.codeSequence` (3), `payable.invoiceSequence`
    (3), `payable.paymentSequence` (3).
- Re-running `db:seed --demo` creates nothing new and never mutates existing rows.

**Verify:** fresh DB → `db:seed` → `db:seed --demo` twice → counts unchanged;
SUP-00001/SUP-00002 exist with details; `stock_receipt.supplier_id` is set on
GRN-00001/GRN-00002; `SINV-00001.subtotal_minor + vat + nhil + getfund` equals the
GRN-00002 line total; `SINV-00001.amount_paid_minor` equals `PAY-00001`'s allocation and
status is `PARTIAL`; `PAY-00002` has zero allocations.
**Commit:** `feat(api): seed demo suppliers, invoices, and payments`

## Done When

All Phase 5 tables exist with the partial uniques and trigram index; `stock_receipt`
carries `supplier_id`; the SUP/SINV/PAY sequences allocate through the settings
mechanism; the eight new permissions are exported with the D10 matrix; the demo seed
carries an idempotent, reconciling AP story built on the existing demo receipts.
