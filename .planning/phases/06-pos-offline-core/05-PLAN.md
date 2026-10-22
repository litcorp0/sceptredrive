---
phase: 06-pos-offline-core
plan: 05
wave: 3
title: Server sale application, upload endpoint, conflicts, and reconciliation
requirements: [POS-05, POS-06, POS-07, POS-08, SYNC-04, SYNC-05, SYNC-06]
depends_on: [01, 03]
status: planned
created: 2026-10-22
---

# Plan 05 — Server Sale Application, Upload, Conflicts, Reconciliation

**Goal:** The server accepts ordered batches of POS transactions, applies each sale in one
atomic DB transaction (sale, lines, tenders, stock movements, credit, loyalty, conflicts,
audit, idempotency), replays duplicates exactly once, never rejects a sale for a business
conflict, and exposes reconciliation that proves every sale and shift.

## Task 1 — Upload endpoint and idempotency ledger

**Files:** `api/src/modules/sync/sync.routes.ts`,
`api/src/modules/sync/sync.controller.ts`,
`api/src/modules/sync/sync.validation.ts`,
`api/src/modules/sync/sync.service.ts`,
`api/src/modules/sync/sync.repository.ts`,
`api/src/modules/sync/sync.types.ts`,
`api/src/modules/sync/sync.test.ts`

- `POST /api/pos/sync/upload` (`deviceAuth`, rate limit 60/min/device):
  body `{ batchId: uuid, deviceId: uuid, terminalId: uuid, transactions: [...] }`,
  `1 ≤ transactions.length ≤ 50`. Each transaction:
  `{ clientTransactionId: uuid, type: 'SALE'|'SHIFT_OPEN'|'CASH_MOVEMENT'|'SHIFT_CLOSE',
  occurredAt: ISO datetime, payloadVersion: 1, payload: object }` — a discriminated union
  validated per type in `sync.validation.ts`.
- Validate body `deviceId`/`terminalId` match the JWT; mismatch → 403. `batchId` is only
  for logging (no batch-level idempotency).
- For each transaction in order:
  1. open one `db.transaction`;
  2. `reserveTransaction`: `INSERT INTO pos_sync_transaction (...) ON CONFLICT
     (terminal_id, client_transaction_id) DO NOTHING RETURNING id`; if no row, load the
     stored row and return `{ status: 'REPLAYED', ...storedResult }` (commit/rollback
     immediately, no side effects);
  3. dispatch by type to `pos.service`;
  4. compute conflicts, update the reservation row with `status`, `result`, `conflictCount`;
  5. commit.
- A thrown `AppError` with `REJECTED` semantics (integrity: unknown product, malformed but
  schema-valid payload, impossible shift) rolls back the domain work, then writes a
  committed reservation with `status='REJECTED'` and an error result plus an
  `UNKNOWN_PRODUCT`/`REJECTED` conflict where applicable. Unexpected errors propagate as
  5xx and leave no reservation so the client retries.
- Response `200`:
  `{ batchId, serverTime, results: [{ clientTransactionId, status, serverId, conflicts:
  [{ id, type, severity }], resolved: { customerId?, saleId?, shiftId? } }] }`.
  Never 4xx for business conflicts (would stall the uploader); 401/403 only for
  auth/scope; 429 with `Retry-After`.
- Tests: mixed batch applies in order; replay returns REPLAYED with identical ids and no
  duplicate rows; a transaction in the middle fails without rolling back neighbours;
  body/JWT mismatch 403; 51 transactions 400; concurrent identical batches create one
  sale.

**Verify:** HTTP tests + SQL count assertions; `check-types`.
**Commit:** `feat(api): add idempotent pos upload endpoint`

## Task 2 — Sale application service

**Files:** `api/src/modules/pos/pos.service.ts`,
`api/src/modules/pos/pos.repository.ts`,
`api/src/modules/pos/pos.types.ts`,
`api/src/modules/pos/pos.conflicts.ts`,
`api/src/modules/pos/pos.pricing.ts`,
`api/src/modules/pos/pos.test.ts`,
`api/src/modules/credit/credit.service.ts` (bypass option),
`api/src/modules/loyalty/loyalty.service.ts` (bypass option)

- Payload: `{ receiptNumber, shiftId, cashier: { userId, staffId, bindingId,
  bindingToken, pinVersion }, customer?: { id?: uuid, phone, name } | null, lines:
  [{ productId, quantity, unitPriceMinor, lineDiscountMinor, taxCategory }],
  saleDiscount: { amountMinor, reasonCode, note, override? } | null,
  loyalty: { redeemPoints, earnPreviewPoints } | null,
  tenders: [{ method, amountMinor }], totals: { subtotalMinor, lineDiscountMinor,
  saleDiscountMinor, loyaltyDiscountMinor, vatMinor, nhilMinor, getfundMinor,
  taxTotalMinor, totalMinor, changeMinor }, occurredAt, appVersion }`.
- `applySale(ctx, tx, payload)`:
  1. **Credentials:** validate the staff binding (device, staff, branch, active, token hash,
     `pinVersion`); if invalid/expired, continue with `STALE_CREDENTIALS` (HIGH) and no
     override authority. Record the cashier ids from the binding when valid, otherwise from
     the payload for audit.
  2. **Shift:** load the shift; require `OPEN`, same terminal/device/branch. A sale without
     an open shift is a `SHIFT_MISSING` rejection (integrity; the client blocks selling).
  3. **Catalog:** load every product (active or archived; archived products still exist).
     Missing product → `UNKNOWN_PRODUCT` rejection. Load effective branch price with
     `resolveEffectivePrice` and compare each charged unit price; mismatch adds
     `PRICE_MISMATCH` (HIGH, details: productId, charged, expected, source) but keeps the
     charged price.
  4. **Customer:** if a draft id/phone is present, resolve with
     `pos.repository.resolveCustomer`: existing by id → use; existing by normalized phone
     → link and `DUPLICATE_CUSTOMER` (LOW); otherwise insert a `customer` with the client
     UUID and a bootstrapped `loyalty_account` (same transaction), then use. Invalid phone
     → `INVALID_CUSTOMER` (LOW) and a walk-in sale.
  5. **Pricing:** `priceCart` with the **charged** unit prices and line tax categories,
     sale discount, and loyalty discount. Compute `earnBase = Σ line.baseMinor`. Compare
     the payload totals with the computed totals. If equal, store computed; if not, verify
     the payload's internal sums (`subtotal + tax = total`, tenders = total, change
     arithmetic) and store the payload split, adding `TOTAL_MISMATCH` (HIGH) with both
     objects. If the payload is internally inconsistent → `REJECTED`.
  6. **Stock:** aggregate line quantities by product; call
     `postMovements(actor, [...], { executor: tx, allowNegative: true })` with type
     `SALE`, `referenceType: 'SALE'`, `referenceId: sale.id`, `referenceNumber:
     receiptNumber`, `unitCostMinor` from the locked level (default 0), note null. If any
     resulting level `< 0`, add `STOCK_OVERSELL` (HIGH, details: productId, onHand,
     quantity). Movements are sorted by the existing service.
  7. **Credit:** if a `CREDIT` tender exists, require a customer and a single credit
     tender equal to the total (Phase 6); call
     `credit.service.postEntry(actor, user, { customerId, branchId, kind: 'CHARGE',
     amountMinor, occurredAt, referenceNumber: receiptNumber, idempotencyKey:
     `${clientTransactionId}:credit`, override })`. Validate the override approver (active,
     branch, role, `credit.override`); a valid one writes the normal override audit.
     For a held account or over-limit charge without a valid override, call `postEntry`
     with the new internal `{ bypassPolicy: true }` option so the ledger records the debt;
     add `CREDIT_HOLD` or `CREDIT_OVER_LIMIT` (HIGH) with balance/limit details. The new
     option is documented as POS-replay-only and defaults to false; existing callers are
     unchanged.
  8. **Loyalty:** if `redeemPoints > 0`, call `loyalty.postEntry` kind `REDEEM` with
     negative points, `occurredAt`, idempotency `${clientTransactionId}:loyalty-redeem`,
     and `{ bypassBalanceCheck: true }`; compare the charged loyalty discount with the
     current `quoteRedeem(points)` value; a difference adds `LOYALTY_RATE_CHANGED` (LOW).
     If the resulting balance is negative, add `LOYALTY_NEGATIVE` (HIGH). Then, if
     `earnBase > 0`, call `postEntry` kind `EARN` with `netPaidMinor: earnBase`,
     idempotency `${clientTransactionId}:loyalty-earn`; compare the result points with
     `earnPreviewPoints` and add `LOYALTY_RATE_CHANGED` if different. `postEntry` returns
     null for a sub-one-point earn (allowed).
  9. **Sale rows:** insert `sale`, `sale_line`s, and `sale_tender`s with the charged
     amounts and the computed splits; set `conflictCount`. The sale `id`, shift id, and
     receipt number are client-provided (UUIDv7 / terminal sequence); uniqueness on
     `(terminalId, clientTransactionId)` and `receiptNumber` is the backstop.
  10. **Clock skew:** if `|receivedAt − occurredAt| > pos.clockSkewToleranceMinutes`, add
     `CLOCK_SKEW` (LOW).
  11. **Audit:** `pos.sale.applied` with receipt, totals, tender methods, customer id,
     conflict types; one `pos.sale.conflict` per conflict (no PII beyond ids).
  12. Return `{ saleId, conflictIds, resolvedCustomerId }`.
- `pos.conflicts.ts`: `addConflict(tx, ctx, { type, severity, details, saleId?, shiftId? })`
  inserts and returns the row; one helper used by sales and shifts.
- Tests: clean cash sale; clean credit sale; duplicate product lines aggregate stock but
  keep two receipt lines; oversell conflict; over-limit credit without/with a valid
  override; held account; loyalty redeem beyond balance; rate drift; price mismatch;
  total mismatch; duplicate phone customer; clock skew; stale binding; unknown product
  rejection; idempotent replay (call twice, one sale).

**Verify:** service tests against `gikautos_test`; `reconcileSales` green after each; SQL
proves one movement per product, credit balance = charge, loyalty balance/lots moved;
`check-types`.
**Commit:** `feat(api): apply offline pos sales with conflicts`

## Task 3 — Conflict read for devices

**Files:** `api/src/modules/sync/sync.routes.ts`,
`api/src/modules/sync/sync.controller.ts`,
`api/src/modules/sync/sync.service.ts`,
`api/src/modules/pos/pos.repository.ts`,
`api/src/modules/sync/sync.test.ts`

- `GET /api/pos/sync/conflicts?since=<ISO>&limit=50` (device JWT): returns conflicts for
  the device's terminal, newest first, `{ id, type, severity, status, saleReceiptNumber?,
  shiftNumber?, details (redacted: ids/amounts only), createdAt }`. Managers/admins do not
  use this route (Phase 8 adds console reads). Branch/terminal scoping is from the JWT.
- `GET /api/pos/sync/state` (device JWT): `{ pendingConflicts, lastSaleAt, serverTime,
  configVersion }` — cheap polling fallback when the local cache is empty.
- Never return another terminal's conflicts; `since` is validated and capped.
- Tests: device sees only its own; other terminal 200 with empty; invalid `since` 400;
  revoked device 403.

**Verify:** HTTP tests; `check-types`.
**Commit:** `feat(api): expose device sync conflicts`

## Task 4 — Reconciliation

**Files:** `api/src/modules/pos/pos.reconciliation.ts`,
`api/src/modules/pos/pos.reconciliation.test.ts`,
`api/src/modules/pos/pos.routes.ts`,
`api/src/modules/pos/pos.controller.ts`,
`api/src/app.ts`

- `reconcileSales(branchId?)` (read-only):
  - every sale: `Σ line.net − discounts` and `Σ line tax components` equal the header
    subtotal/VAT/NHIL/GETFund/taxTotal; `Σ tenders = total`; `change = Σ cash tender −
    total` when overpaid; `creditAmount = Σ CREDIT tenders`;
  - each `SALE` stock movement references the sale and each product's movement quantity
    equals the aggregated line quantity; `referenceNumber = receiptNumber`;
  - a credit tender has exactly one `credit_ledger_entry` CHARGE with the same amount and
    reference; a loyalty redemption has a REDEEM entry with the same points and a
    non-zero loyalty discount;
  - `receiptNumber` unique per terminal; `clientTransactionId` unique per terminal.
- `reconcileShifts(branchId?)`: `serverExpected = float + Σ cash sales − change + Σ in −
  Σ out`; `variance = counted − serverExpected`; CLOSED shifts have counted/variance;
  OPEN shifts have no close fields; one OPEN per terminal.
- `GET /api/pos/reconciliation` (`requireSession`,
  `requirePermission('inventory.read')`, admin all/manager own branch) returns
  `{ sales: divergences[], shifts: divergences[] }`; read-only, no auto-correction.
- Tests: a clean seeded dataset returns zero; deliberately corrupt a row in a test-only
  fixture (direct SQL) and assert the divergence is reported; branch scoping.

**Verify:** tests + `psql` spot checks; `check-types`.
**Commit:** `feat(api): add sale and shift reconciliation`

## Done When

A batch of POS transactions applies exactly once in order; every business conflict is
recorded while the sale still applies; credit and loyalty ledgers move even when the
offline policy was violated; and `reconcileSales`/`reconcileShifts` prove the arithmetic
for the demo and every test fixture.
