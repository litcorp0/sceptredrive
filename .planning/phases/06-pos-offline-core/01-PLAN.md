---
phase: 06-pos-offline-core
plan: 01
wave: 1
title: Phase 6 schema, shared cart math, settings, permissions, and demo seed
requirements: [POS-04, POS-05, POS-06, POS-07, POS-08, POS-14, SYNC-01, SYNC-05, SYNC-06]
depends_on: []
status: planned
created: 2026-10-22
---

# Plan 01 — Schema, Shared Cart Math, Settings, Permissions, Demo Seed

**Goal:** The sale, shift, conflict, idempotency, and staff-binding tables exist with the
right constraints; `stock_movement` can carry `SALE`; the shared pure cart engine is the
single implementation of discounts, loyalty, and tax; the Phase 6 settings and
permissions exist; and the demo seed carries POS settings plus one reconciling closed
shift with a cash sale and a credit sale.

## Task 1 — POS schema + stock movement `SALE`

**Files:** `api/src/modules/pos/pos.schema.ts`,
`api/src/modules/inventory/inventory.schema.ts`, generated `api/migrations/0007_*.sql`
(+ `api/migrations/meta/`)

- Add `SALE` to `stockMovementTypeEnum` and `SALE` to `stockMovementReferenceEnum`.
- `pos.schema.ts` enums: `sale_tender_method` `['CASH','CREDIT']` (Phase 7 extends with
  electronic methods), `shift_status` `['OPEN','CLOSED']`,
  `cash_movement_type` `['CASH_IN','CASH_OUT']`,
  `sync_conflict_type` `['STOCK_OVERSELL','CREDIT_OVER_LIMIT','CREDIT_HOLD',
  'LOYALTY_NEGATIVE','LOYALTY_RATE_CHANGED','PRICE_MISMATCH','TOTAL_MISMATCH',
  'SHIFT_VARIANCE_MISMATCH','STALE_CREDENTIALS','OVERRIDE_INVALID','DUPLICATE_CUSTOMER',
  'CLOCK_SKEW','INVALID_CUSTOMER','UNKNOWN_PRODUCT']`,
  `sync_conflict_severity` `['LOW','MEDIUM','HIGH']`,
  `sync_conflict_status` `['OPEN','RESOLVED','DISMISSED']`,
  `pos_transaction_type` `['SALE','SHIFT_OPEN','CASH_MOVEMENT','SHIFT_CLOSE']`.
- `shift`: uuid pk; `number` text notNull; `branchId` fk branch (restrict); `terminalId`
  fk terminal (restrict); `deviceId` fk device (restrict); `cashierUserId` text;
  `cashierStaffId` text; `status` enum notNull default `OPEN`; `openedAt` timestamptz
  notNull; `closedAt` timestamptz; `openingFloatMinor` integer notNull default 0;
  `countedCashMinor` integer; `clientExpectedCashMinor` integer;
  `serverExpectedCashMinor` integer; `varianceMinor` integer; `closeNote` text;
  `openedBy`/`closedBy` text; timestamps. Indexes: unique `shift_number_unique`;
  **partial unique** `shift_one_open_per_terminal` on `(terminalId) WHERE status = 'OPEN'`;
  `(branchId, openedAt)`, `(terminalId, openedAt)`.
- `sale`: uuid pk (client UUIDv7 supplied); `receiptNumber` text notNull; `branchId` fk
  branch (restrict); `terminalId` fk terminal (restrict); `deviceId` fk device (restrict);
  `shiftId` fk shift (restrict); `clientTransactionId` uuid notNull; `cashierUserId` text;
  `cashierStaffId` text; `customerId` uuid nullable fk customer (restrict);
  `occurredAt` timestamptz notNull; `receivedAt` timestamptz notNull defaultNow;
  `subtotalMinor` integer notNull; `lineDiscountMinor` integer notNull default 0;
  `saleDiscountMinor` integer notNull default 0; `loyaltyRedeemPoints` integer notNull
  default 0; `loyaltyDiscountMinor` integer notNull default 0; `vatMinor`, `nhilMinor`,
  `getfundMinor` integer notNull default 0; `taxTotalMinor` integer notNull default 0;
  `totalMinor` integer notNull; `tenderTotalMinor` integer notNull; `changeMinor` integer
  notNull default 0; `loyaltyEarnedPoints` integer notNull default 0;
  `creditAmountMinor` integer notNull default 0; `taxMode` text notNull;
  `conflictCount` integer notNull default 0; `appVersion` text; `createdAt`.
  Indexes: unique `sale_receipt_number_unique`; unique `(terminalId, clientTransactionId)`;
  `(branchId, occurredAt)`, `(terminalId, occurredAt)`, `(customerId, occurredAt)`,
  `(shiftId)`.
- `sale_line`: uuid pk defaultRandom; `saleId` fk sale (cascade); `productId` fk product
  (restrict); `lineNumber` integer notNull; `sku`/`name` text notNull (snapshot);
  `barcode` text; `quantity` integer notNull (> 0); `unitPriceMinor` integer notNull;
  `expectedUnitPriceMinor` integer notNull; `lineDiscountMinor` integer notNull default 0;
  `saleDiscountMinor` integer notNull default 0; `loyaltyDiscountMinor` integer notNull
  default 0; `netMinor`, `taxableMinor`, `baseMinor`, `vatMinor`, `nhilMinor`,
  `getfundMinor`, `taxTotalMinor`, `totalMinor` integer notNull; `taxCategory` text
  notNull; `unitCostMinor` integer notNull default 0; `priceSource` text notNull
  (`BASE`/`OVERRIDE`/`CHARGED`); timestamps. Indexes: unique `(saleId, lineNumber)`;
  `(saleId)`, `(productId)`.
- `sale_tender`: uuid pk defaultRandom; `saleId` fk sale (cascade); `method` enum notNull;
  `amountMinor` integer notNull (> 0); `reference` text; `createdAt`. Indexes: `(saleId)`;
  unique `(saleId, method)` (single tender in Phase 6; relaxed when split tender arrives).
- `cash_movement`: uuid pk (client UUIDv7); `shiftId` fk shift (restrict); `branchId` fk
  branch; `terminalId` fk terminal; `deviceId` fk device; `type` enum notNull;
  `amountMinor` integer notNull (> 0); `reason` text notNull; `occurredAt` timestamptz
  notNull; `staffUserId`/`staffStaffId` text; `receivedAt` defaultNow; `createdBy` text.
  Indexes: `(shiftId, occurredAt)`, `(branchId, occurredAt)`.
- `pos_sync_transaction`: uuid pk defaultRandom; `terminalId` fk terminal (restrict);
  `deviceId` fk device (restrict); `clientTransactionId` uuid notNull; `type` enum notNull;
  `status` text notNull (`APPLIED`/`REPLAYED`/`REJECTED`); `result` jsonb notNull default
  `{}`; `conflictCount` integer notNull default 0; `occurredAt` timestamptz notNull;
  `appliedAt` timestamptz notNull defaultNow. Unique
  `pos_sync_transaction_client_unique` on `(terminalId, clientTransactionId)`;
  `(terminalId, appliedAt)`.
- `sync_conflict`: uuid pk defaultRandom; `branchId` fk branch; `terminalId` fk terminal;
  `deviceId` fk device; `saleId` uuid nullable fk sale (set null); `shiftId` uuid nullable
  fk shift (set null); `type` enum notNull; `severity` enum notNull; `status` enum notNull
  default `OPEN`; `details` jsonb notNull default `{}`; `resolvedBy` text; `resolvedAt`
  timestamptz; `resolutionNote` text; `createdAt`. Indexes: `(branchId, status, severity)`,
  `(terminalId, createdAt)`, `(saleId)`.
- `pos_staff_binding`: uuid pk defaultRandom; `deviceId` fk device (restrict);
  `staffUserId` text notNull; `staffStaffId` text notNull; `role` text notNull;
  `branchId` fk branch (restrict); `pinVersion` integer notNull; `bindingTokenHash` text
  notNull; `authorizedAt` defaultNow; `expiresAt` timestamptz notNull; `revokedAt`
  timestamptz; `revokedBy` text; `lastUsedAt` timestamptz. **Partial unique**
  `pos_staff_binding_active_unique` on `(deviceId, staffUserId) WHERE revoked_at IS NULL`;
  `(deviceId, staffUserId)`, `(staffUserId)`. `bindingTokenHash` is never returned after
  creation.
- Generate with `bun run db:generate`; inspect the SQL (enum alterations must be additive);
  append the trigram-free indexes as generated; migrate; `bun run db:test:prepare`.

**Verify:** migrations apply on dev + test; `\d sale`, `\d shift`, `\d sync_conflict`,
`\d pos_staff_binding` show the constraints; two open shifts for one terminal fail; two
`pos_sync_transaction` rows with the same terminal+client id fail; `stock_movement.type`
accepts `SALE`; `bun run --filter api check-types`.
**Commit:** `feat(api): add pos sale, shift, and sync schema`

## Task 2 — Shared cart engine

**Files:** `packages/shared/src/pos.ts`, `packages/shared/src/pos.test.ts`,
`packages/shared/src/index.ts`

- `allocateProportionally(amountMinor, weights)` — integer largest-remainder allocation;
  returns an array summing exactly to `amountMinor`; zero weights get zero; a zero total
  weight allocates nothing (caller must guard). Reject negative/non-integer inputs.
- Types: `CartLineInput { productId, quantity, unitPriceMinor, lineDiscountMinor,
  taxCategory, name?, sku? }`; `CartOptions { taxMode, saleDiscountMinor?,
  loyaltyDiscountMinor? }`; `PricedCart`, `PricedLine`.
- `priceCart(lines, options)`:
  1. validate quantities > 0, prices ≥ 0, discounts `0 ≤ d ≤ gross`;
  2. line net = `unitPrice × quantity − lineDiscount`;
  3. sale discount allocated by line net (largest remainder), never exceeding net;
  4. loyalty discount allocated by remaining net (largest remainder), never exceeding
     remaining net (clamp when the discount exceeds the cart);
  5. `taxBreakdown(taxable, category, taxMode)` per line;
  6. totals are exact sums; `total === Σ line.total`.
  Return per-line `{ gross, lineDiscount, saleDiscount, loyaltyDiscount, net, taxable,
  base, vat, nhil, getfund, taxTotal, total }`.
- Reuse `resolveEffectivePrice` for the client/server price lookup; do not duplicate.
- Tests: single line inclusive/exclusive; mixed standard/zero-rated/exempt; 100% line
  discount; sale discount across three odd-pesewa lines; loyalty larger than the cart
  clamps; zero-priced line; quantity > 1; allocation residual invariants; invalid input
  rejections.

**Verify:** `bun run --filter shared test`; `bun run --filter api check-types`; a
property-style loop (e.g. 200 random carts) asserts `Σ line.total === cart.total` and each
line's components sum exactly.
**Commit:** `feat(shared): add pure pos cart pricing engine`

## Task 3 — Phase 6 settings

**Files:** `api/src/modules/platform/settings.validation.ts`,
`api/src/modules/platform/settings.service.ts`,
`api/src/modules/platform/platform.test.ts`

- Add global/admin-only definitions: `pos.maxCashierDiscountPercent` (int 0–100, default
  0), `pos.maxManagerDiscountPercent` (0–100, default 100), `pos.pinMaxAttempts` (3–10,
  default 5), `pos.pinLockMinutes` (1–60, default 5),
  `pos.clockSkewToleranceMinutes` (1–120, default 10), `pos.syncBatchSize` (1–50, default
  25), `pos.receiptFooter` (string 1–200, default `Thank you for your business`),
  `pos.salesRequireOpenShift` (boolean, default true).
- No new sequences: receipt/shift numbers are per-terminal local sequences (D13).
- Tests: defaults resolve; manager write → 403; out-of-range values reject; boolean
  coercion follows the existing schema conventions.

**Verify:** `bun run --filter api test` (after `db:test:prepare`); `check-types`.
**Commit:** `feat(api): add phase 6 pos settings`

## Task 4 — Shared permissions

**Files:** `packages/shared/src/permissions.ts`,
`packages/shared/src/permissions.test.ts`

- Add `staff.pin.reset` and `pos.discount`.
- Matrix: ADMIN all; MANAGER gains both (`staff.pin.reset` is branch-scoped at the route
  level); CASHIER still none. No existing role loses a permission.
- Update counts/duplicate assertions and add explicit manager/cashier expectations.

**Verify:** `bun run --filter shared test`; `bun run --filter api check-types`.
**Commit:** `feat(shared): add pos and staff pin permissions`

## Task 5 — Demo seed POS story

**Files:** `api/src/seed/helpers.ts`, `api/src/seed/demo.ts`

- Helpers (direct Drizzle, idempotent by natural key; do not call HTTP):
  - `ensurePosSettings()` — the eight settings with defaults.
  - `ensureDemoPin(staffEmail, pin)` — Argon2id hash via `api/src/auth/password.ts`,
    `pinVersion = 1`; only when `pin_hash IS NULL`; the PIN is documented in the seed
    output (`2468`) and is a temp PIN (`mustChangePin` is not a column — the POS relies on
    the binding flow; the demo note says "change at POS").
  - `ensureDemoShift({ number, terminalCode, cashierEmail, openedAt, closedAt,
    openingFloatMinor, countedCashMinor })`.
  - `ensureDemoSale({ receiptNumber, shiftNumber, type: 'CASH' | 'CREDIT', lines,
    customerPhone? })` — prices with the shared `priceCart`, writes sale/lines/tenders,
    posts `SALE` stock movements through `postMovements` with `allowNegative: true`,
    posts the credit charge through `credit.service.postEntry` for the credit sale, earns
    loyalty for both, and links the shift. Idempotent by receipt number.
  - `ensureDemoConflict({ saleReceiptNumber, type, severity, details })` — one `RESOLVED`
    conflict so Phase 8 screens have a sample.
- Demo data at ACC-SPX: `SPX-T01-20261020-0001` cash sale (2 lines, one discounted) and
  `SPX-T01-20261020-0002` credit sale for the seeded Akosua (within limit), both under
  `SPX-T01-S-20261020-01` (closed, variance 0), customer Kwame earns points. All values
  computed from the shared cart engine so `reconcileSales` is green.
- Re-running `db:seed --demo` creates nothing new and never mutates existing rows.

**Verify:** fresh DB → seed → demo seed twice → counts unchanged; `reconcileSales()` and
`reconcileShifts()` (from Plan 05, or raw SQL before it) return zero divergences; the cash
sale's tenders equal its total; the credit sale's balance moved by its total; stock
movements reference both receipts; the demo PIN verifies with `@node-rs/argon2`.
**Commit:** `feat(api): seed demo pos shift, sales, and conflict`

## Done When

Every Phase 6 table exists with its unique/partial indexes; `stock_movement` carries
`SALE`; the shared cart engine is the only pricing implementation and is fully tested; the
eight POS settings and two permissions are live; and a fresh demo database contains a
closed shift, a cash sale, a credit sale, loyalty movement, and a sample conflict that all
reconcile.
