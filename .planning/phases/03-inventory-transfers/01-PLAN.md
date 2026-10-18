---
phase: 03-inventory-transfers
plan: 01
wave: 1
title: Inventory schema, migration, settings, and demo seed
requirements: [INV-01, INV-02, INV-03, INV-05, INV-06, INV-07, INV-08]
depends_on: []
status: planned
created: 2026-10-18
---

# Plan 01 — Inventory Schema, Migration, Settings, Demo Seed

**Goal:** The append-only stock ledger, per-branch projection, transfers, counts, and
threshold tables exist with the right constraints; document sequences are configured;
the demo seed carries idempotent opening stock.

## Task 1 — Ledger, projection, transfer, and count schema + migration

**Files:** `api/src/modules/inventory/inventory.schema.ts`,
`api/src/modules/transfers/transfers.schema.ts`,
`api/src/modules/counts/counts.schema.ts`, generated
`api/migrations/0003_*.sql` (+ `api/migrations/meta/`)

- `inventory.schema.ts`:
  - `pgEnum('stock_movement_type', ['RECEIPT','ADJUSTMENT','TRANSFER_OUT','TRANSFER_IN','COUNT_VARIANCE'])`
    and `pgEnum('stock_movement_reference', ['RECEIPT','ADJUSTMENT','TRANSFER','COUNT'])` and
    `pgEnum('stock_adjustment_reason', ['DAMAGE','LOSS','FOUND','CORRECTION','EXPIRED','OTHER'])`.
  - `stock_movement`: uuid pk; `productId` fk product (restrict); `branchId` fk branch
    (restrict); `type` enum; `quantityDelta` integer notNull (signed, non-zero — validated
    in service; no DB check so Phase 6 oversell can post negatives); `unitCostMinor`
    integer notNull; `referenceType` enum notNull; `referenceId` uuid (nullable for
    standalone adjustments); `referenceNumber` text; `reasonCode` enum (adjustments);
    `note` text; `createdBy` text; `createdAt` timestamptz defaultNow. Indexes:
    `(productId, branchId, createdAt)`, `(branchId, createdAt)`, `(referenceType, referenceId)`,
    `(type, createdAt)`.
  - `stock_level`: uuid pk; `productId` fk (restrict); `branchId` fk (restrict);
    `quantityOnHand` integer notNull default 0; `avgCostMinor` integer notNull default 0;
    timestamps with `$onUpdate`; `unique(productId, branchId)`; `index(branchId)`.
  - `stock_threshold`: uuid pk; `productId` fk; `branchId` fk; `threshold` integer notNull;
    `updatedBy` text; timestamps; `unique(productId, branchId)`.
  - `stock_receipt`: uuid pk; `number` text notNull; `branchId` fk (restrict);
    `supplierName` text; `supplierInvoiceNumber` text; `note` text; `createdBy` text;
    `createdAt` timestamptz; `unique(number)`, `index(branchId)`.
  - `stock_receipt_line`: uuid pk; `receiptId` fk cascade; `productId` fk restrict;
    `quantity` integer notNull; `unitCostMinor` integer notNull; `movementId` fk
    stock_movement (restrict, nullable until posted — always set in practice);
    `unique(receiptId, productId)`, `index(receiptId)`.
- `transfers.schema.ts`: `pgEnum('transfer_status', ['DRAFT','DISPATCHED','RECEIVED','SHORT_CLOSED','CANCELLED'])`;
  `transfer`: uuid pk; `number` text notNull; `fromBranchId`/`toBranchId` fk branch
  (restrict); `status` enum default `DRAFT`; `note`; `createdBy`; `dispatchedBy`/`dispatchedAt`;
  `receivedBy`/`receivedAt`; `closedBy`/`closedAt`; `cancelledBy`/`cancelledAt`; timestamps;
  `unique(number)`, `index(fromBranchId)`, `index(toBranchId)`, `index(status)`.
  `transfer_line`: uuid pk; `transferId` fk cascade; `productId` fk restrict;
  `quantityRequested` integer notNull; `quantityDispatched` integer notNull default 0;
  `quantityReceived` integer notNull default 0; `unitCostMinor` integer notNull default 0;
  `unique(transferId, productId)`, `index(transferId)`.
- `counts.schema.ts`: `pgEnum('stock_count_status', ['OPEN','POSTED','CANCELLED'])`;
  `stock_count`: uuid pk; `number`; `branchId` fk; `categoryId` fk category (set null);
  `status` default `OPEN`; `note`; `createdBy`; `postedBy`/`postedAt`;
  `cancelledBy`/`cancelledAt`; timestamps; `unique(number)`, `index(branchId)`, `index(status)`.
  `stock_count_line`: uuid pk; `countId` fk cascade; `productId` fk restrict;
  `snapshotQty` integer notNull; `countedQty` integer (nullable = not counted);
  `unique(countId, productId)`, `index(countId)`.
- Generate with `bun run db:generate`; inspect the generated SQL (no extension needed
  this phase); run `bun run db:migrate` and `bun run db:test:prepare`.

**Verify:** `bun run db:migrate` applies cleanly on the dev DB; `bun run db:test:prepare`
recreates `gikautos_test`; `bun run --filter api check-types`; `\d stock_movement` shows
the indexes.
**Commit:** `feat(api): add inventory ledger, transfer, and count schema`

## Task 2 — Document sequence settings

**Files:** `api/src/modules/platform/settings.validation.ts`,
`api/src/modules/platform/settings.service.ts`,
`api/src/modules/platform/platform.test.ts`

- New settings: `inventory.receiptPrefix` (default `GRN`), `inventory.receiptSequence`
  (default 1), `inventory.transferPrefix` (`TRF`), `inventory.transferSequence` (1),
  `inventory.countPrefix` (`CNT`), `inventory.countSequence` (1) — same string regex/int
  schemas as `staff.*`/`catalog.*`.
- Extend `SequenceKey` with `inventory.receiptSequence | inventory.transferSequence |
  inventory.countSequence` and `SEQUENCE_FORMATS` (pad 5, labels "goods receipt number",
  "transfer number", "count number").
- Managers must not change these global settings (existing rule: global settings are
  admin-only — confirm by test).

**Verify:** platform tests: each sequence allocates `GRN-00001`-style values, peeks
without consuming, `advanceSequencePast` bumps past explicit values; manager update of a
global inventory sequence → 403; full `bun run test` green after `db:test:prepare`.
**Commit:** `feat(api): add inventory document sequence settings`

## Task 3 — Demo seed opening stock

**Files:** `api/src/seed/demo.ts`, `api/src/seed/helpers.ts`

- Helpers: `ensureStockReceipt({ number, branchId, lines, supplierName?, supplierInvoiceNumber?, actor })`
  — creates a receipt document + lines + `RECEIPT` movements + level rows **directly via
  Drizzle** (the API service does not exist during seeding; keep the invariant: movement
  and level write inside one transaction) and is a no-op when the receipt number exists;
  `ensureStockThreshold({ productId, branchId, threshold })`.
- Demo: opening receipts dated in the past — warehouse gets 40–120 units of each demo
  product at `product.costPriceMinor`; Spintex gets smaller quantities; set thresholds on
  2–3 products so the low-stock list has at least one hit (e.g. a filter with on-hand
  below threshold). Re-running `db:seed --demo` is a no-op.
- Keep the seed idempotent by receipt number; never mutate existing levels on re-run.

**Verify:** fresh DB → `db:seed` → `db:seed --demo` twice → `stock_level` sums equal
movement sums for every product/branch; low-stock query finds the seeded example; second
run creates nothing new (row counts unchanged).
**Commit:** `feat(api): seed demo opening stock and thresholds`

## Done When

All Phase 3 tables exist with constraints and indexes; GRN/TRF/CNT sequences allocate
through the settings mechanism; the demo seed carries idempotent opening stock that
already satisfies the `on_hand = SUM(movements)` invariant.
