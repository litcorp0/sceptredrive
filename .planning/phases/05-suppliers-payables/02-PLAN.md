---
phase: 05-suppliers-payables
plan: 02
wave: 2
title: Suppliers module — master, payment details, supplied products, last cost
requirements: [SUP-01, SUP-02]
depends_on: [01]
status: planned
created: 2026-10-19
---

# Plan 02 — Suppliers Module

**Goal:** Supplier master data is fully managed through the API: create/search/read/update,
archive/reactivate with the debt guard, bank and MoMo payment details with a single active
default, and supplied-product mappings that carry the supplier SKU and last cost.

## Task 1 — Repository and types

**Files:** `api/src/modules/suppliers/suppliers.repository.ts`,
`api/src/modules/suppliers/suppliers.types.ts`

- Repository (Drizzle only, no business rules):
  - `insertSupplier`, `findSupplierById`, `findSupplierByCode`, `updateSupplierRow`,
    `setSupplierStatus`, `selectSupplierPage` (name ILIKE / code prefix search, status
    filter, `limit`/`offset`), `countSuppliers`.
  - `insertPaymentDetail`, `findPaymentDetailById`, `listPaymentDetailsBySupplier`,
    `updatePaymentDetailRow`, `clearDefaultPaymentDetails(supplierId, executor)`.
  - `insertSupplierProduct`, `findSupplierProductById`,
    `listSupplierProductsBySupplier` (joined with product SKU/name/tax category),
    `updateSupplierProductRow`, `deleteSupplierProductRow`,
    `clearPreferredSupplierProduct(productId, executor)`,
    `updateLastCost(supplierId, productIds, costByProduct, occurredAt, executor)`.
  - `sumSupplierOwed(supplierId, executor)` — the archive guard: reads
    `payables.schema` tables directly (schema-level import, Phase 4 D22 pattern; keeps
    `suppliers` free of a `payables` service dependency) and returns the D9 owed figure
    (invoice outstanding minus on-account remainders, VOID excluded).
- Types: `SupplierRow`, `SupplierDetail` (supplier + payment details + products),
  `SupplierListQuery`, `SupplierCreateInput`, `SupplierUpdateInput`,
  `PaymentDetailInput`, `SupplierProductInput` (`z.infer` aliases).

**Verify:** `bun run --filter api check-types`.
**Commit:** `feat(api): add suppliers repository and types`

## Task 2 — Master service, CRUD, archive guard

**Files:** `api/src/modules/suppliers/suppliers.service.ts`,
`api/src/modules/suppliers/suppliers.validation.ts` (schemas here, validators with the
routes in Task 5)

- `listSuppliers(user, query)`: archived hidden by default (`includeArchived` admin-only,
  mirroring customer search); search matches name (trigram-backed ILIKE) or exact code;
  `page`/`pageSize` (default 20).
- `createSupplier(user, actor, input)`: allocate `code` with
  `allocateFromSequence('supplier.codeSequence', tx)`; normalize `phone` with
  `normalizeGhanaPhone` (null when absent, 400 on invalid); defaults
  `paymentTermDays = 0`; audit `supplier.created`; duplicate code impossible (sequence).
- `updateSupplier(user, actor, id, input)`: patch the master fields, normalize phone;
  audit `supplier.updated` with before/after.
- `archiveSupplier(actor, id)`: inside a transaction, lock the supplier row
  `FOR UPDATE`, compute `sumSupplierOwed`; non-zero → 409 naming the amount owed
  ("settle or void open invoices first"); set `ARCHIVED`; audit
  `supplier.archived`. `reactivateSupplier` mirrors it (`supplier.reactivated`).
- `requireSupplier(id, executor?)` — the seam payables and inventory call; 404 when
  missing, 409 "supplier is archived" for new documents; exported for
  service-to-service use.
- `recordInvoiceCosts(supplierId, lines, occurredAt, executor)` — updates
  `last_cost_minor`/`last_cost_at` on mappings for the given products; the seam Plan 03
  calls inside the invoice transaction. No-op for unmapped products.

**Verify:** integration tests (new `suppliers.test.ts`): create with/without phone
(valid `024…` normalizes to `+233…`, invalid → 400); list search by name fragment and
code; update; archive allowed at zero owed and blocked (409, message names the amount)
after a seeded invoice; archived supplier cannot be used by `requireSupplier`.

**Commit:** `feat(api): add suppliers master service`

## Task 3 — Payment details (bank / MoMo)

**Files:** `api/src/modules/suppliers/suppliers.service.ts`,
`api/src/modules/suppliers/suppliers.validation.ts`,
`api/src/modules/suppliers/suppliers.test.ts`

- `addPaymentDetail(user, actor, supplierId, input)`: method-conditional validation —
  BANK requires `accountName`, `accountNumber`, `bankName` (bank code optional);
  MOMO requires `momoNetwork` (`MTN`|`VOD`|`ATL`) and `phone` (E.164 normalized);
  reject fields that do not belong to the method; a supplier's first active detail
  becomes the default automatically; setting `isDefault: true` clears the previous
  default in the same transaction (partial unique index backs this).
- `updatePaymentDetail(user, actor, supplierId, detailId, input)`: contact/bank fields,
  `isDefault` (switch default atomically), `isActive` (deactivating the default clears
  the flag). Rows are never deleted.
- Reads return the full account number only on the supplier detail payload; list
  endpoints return `accountNumberMasked` (`•••• 1234`) and never the raw value.
- Audit `supplier_payment_detail.created` / `.updated` with method, flags, and the
  **masked** account number (D16 — no raw account numbers in audit or logs).

**Verify:** tests: method misuse rejected; duplicate `(supplier, method, account)`
409; default switch leaves exactly one active default (assert via two inserts and the
unique index); deactivating the default leaves the supplier without a default; masked
value in list responses; audit rows carry no raw number.

**Commit:** `feat(api): add supplier payment details`

## Task 4 — Supplied products and last cost

**Files:** `api/src/modules/suppliers/suppliers.service.ts`,
`api/src/modules/suppliers/suppliers.validation.ts`,
`api/src/modules/suppliers/suppliers.test.ts`

- `addSupplierProduct(user, actor, supplierId, input)`: validate the product exists and
  is active (`products.repository.findProductById`, the inventory `requireActiveProduct`
  pattern); duplicate `(supplier, product)` → 409; `isPreferred: true` clears the
  previous preferred supplier for that product in the same transaction.
- `updateSupplierProduct` (supplier SKU, lead time, preferred), `removeSupplierProduct`
  (audited `supplier_product.deleted`; metadata only — invoice history keeps product
  ids and never joins through the mapping for money).
- `getSupplierDetail(user, id)`: master + active payment details (raw numbers, this is
  the owning screen) + product mappings joined to product SKU/name, each with
  `lastCostMinor`/`lastCostAt`.
- Tests: mapping CRUD, duplicate 409, preferred switching, archived product 409, last
  cost updates applied by `recordInvoiceCosts` and left alone for unmapped products.

**Verify:** tests green; `bun run --filter api test` after `db:test:prepare`.
**Commit:** `feat(api): add supplier products and last cost`

## Task 5 — Routes, validation, and wiring

**Files:** `api/src/modules/suppliers/suppliers.routes.ts`,
`api/src/modules/suppliers/suppliers.validation.ts`,
`api/src/modules/suppliers/suppliers.controller.ts`, `api/src/app.ts`,
`api/src/modules/suppliers/suppliers.test.ts`

- Routes (permission → handler):
  - `GET /api/suppliers` `supplier.read`; `POST /api/suppliers` `supplier.create`;
  - `GET /api/suppliers/:id` `supplier.read`; `PATCH /api/suppliers/:id`
    `supplier.update`; `POST /api/suppliers/:id/archive|reactivate`
    `supplier.archive`;
  - `POST /api/suppliers/:id/payment-details` `supplier.update`;
    `PATCH /api/suppliers/:id/payment-details/:detailId` `supplier.update`;
  - `POST /api/suppliers/:id/products` `supplier.update`;
    `PATCH /api/suppliers/:id/products/:mappingId` `supplier.update`;
    `DELETE /api/suppliers/:id/products/:mappingId` `supplier.update`.
- Zod: strict bodies; `momoNetwork` enum; phone strings length-capped; `pageSize` max
  100; path params `z.uuid()`. Compose validators as in `customers.validation.ts`.
- Controllers stay thin (validated input → service → JSON envelope); register
  `suppliersRoutes` in `app.ts`.
- Integration tests through `app.request()`: permission matrix (manager create/update/
  archive → 403; cashier read → 403), happy paths, 404s, validation 400s.

**Verify:** `bun run --filter api test` green; `bun run --filter api check-types`;
`bun run lint`.
**Commit:** `feat(api): expose supplier routes`

## Done When

Suppliers can be created, searched, edited, archived (debt-guarded), and reactivated;
bank/MoMo payment details work with exactly one active default and masked list
responses; supplied products carry supplier SKUs and last costs updated by invoice
recording; every route is permission-checked and audited.
