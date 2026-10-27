---
phase: 13-pos-payments-returns
plan: 07
title: X/Z reports, the shift snapshot and the nightly payment sweep
lane: api
depends_on: [04]
requirements: [POS-13, POS-10, POS-16, PAY-02]
---

# Plan 07 — Two questions, one arithmetic

## Goal

Closing a shift writes an immutable Z-report snapshot in the same transaction as the close. An
X-report — "how are we doing?" — is computed on demand and stored nowhere. Both are built from the
shift's own rows, and both reconcile to the ledgers. A nightly sweep stops a stranded `PENDING`
payment from sitting there for ever.

## Read first

- `00-DECISIONS.md` P13-D32 … P13-D35, P13-D12.
- `01-RESEARCH.md` §4 items 29–31.
- `api/src/modules/pos/pos.service.ts:572-719` — `closeShift`, including the Phase 12 review block.
- `api/src/modules/pos/pos.repository.ts:260-296` — `selectShiftCashTotals`, the only cash arithmetic.
- `api/src/modules/pos/pos.reconciliation.ts:248-331` — `reconcileShifts`, which must keep passing.
- `api/src/modules/analytics/*.repository.ts` — the aggregate query style (one statement, no N+1).
- `api/src/jobs/queues.ts:20-100` — the register/schedule pattern to extend.

## Tasks

### 1. One aggregate query

`pos.repository.ts` gains `selectShiftReportFigures(shiftId, executor)`:

```sql
SELECT
  COUNT(*) FILTER (WHERE s.id IS NOT NULL)                     AS sale_count,
  COALESCE(SUM(s.total_minor), 0)                              AS gross_minor,
  COALESCE(SUM(s.tender_total_minor), 0)                       AS tender_total_minor,
  COALESCE(SUM(s.change_minor), 0)                             AS change_minor,
  COALESCE(SUM(s.line_discount_minor), 0)                      AS line_discount_minor,
  COALESCE(SUM(s.sale_discount_minor), 0)                      AS sale_discount_minor,
  COALESCE(SUM(s.loyalty_discount_minor), 0)                   AS loyalty_discount_minor,
  COALESCE(SUM(s.loyalty_redeem_points), 0)                    AS loyalty_redeem_points,
  COALESCE(SUM(s.loyalty_earned_points), 0)                    AS loyalty_earned_points,
  COALESCE(SUM(s.base_minor), 0)                               AS base_minor,
  COALESCE(SUM(s.vat_minor), 0)                                AS vat_minor,
  COALESCE(SUM(s.nhil_minor), 0)                               AS nhil_minor,
  COALESCE(SUM(s.getfund_minor), 0)                            AS getfund_minor,
  COALESCE(SUM(s.tax_total_minor), 0)                          AS tax_total_minor
FROM sale s WHERE s.shift_id = $1
```

Note: `sale` has no `base_minor` column — `base_minor` lives on `sale_line`. Sum it from
`sale_line` in a second CTE in the same statement, or add the column. **Prefer the CTE**: adding a
denormalised column to an immutable table for one report is the wrong direction, and `sale_line`'s
base is the authoritative one.

The same statement, in one round trip, returns:

- tender totals by method: `SELECT method, SUM(amount_minor) FROM sale_tender st JOIN sale s ON …
  WHERE s.shift_id = $1 GROUP BY method`;
- refunds: `SELECT COUNT(*), SUM(refunded_minor), SUM(base_minor), … FROM refund WHERE shift_id = $1`;
- voids: `SELECT COUNT(*), SUM(gross_minor) FROM cart_void WHERE shift_id = $1`;
- item count: `SELECT COALESCE(SUM(quantity), 0) FROM sale_line sl JOIN sale s …`;
- cash in/out: reuse `selectShiftCashTotals`.

### 2. `closeShift` writes the snapshot

Inside the existing transaction, after `updateShiftClose` and before `requestApproval`:

```ts
const figures = await selectShiftReportFigures(payload.shiftId, executor)
await insertShiftReport({
  shiftId: row.id, branchId: row.branchId, terminalId: row.terminalId, deviceId: row.deviceId,
  number: row.number, openedAt: row.openedAt, closedAt: closedAt,
  openingFloatMinor: row.openingFloatMinor,
  saleCount: figures.saleCount, itemCount: figures.itemCount,
  refundCount: figures.refundCount, voidCount: figures.voidCount,
  grossMinor: figures.grossMinor, refundMinor: figures.refundMinor,
  netMinor: figures.grossMinor - figures.refundMinor,
  lineDiscountMinor: …, saleDiscountMinor: …, loyaltyDiscountMinor: …,
  loyaltyRedeemPoints: …, loyaltyEarnedPoints: …,
  baseMinor: …, vatMinor: …, nhilMinor: …, getfundMinor: …, taxTotalMinor: …,
  cashMinor: figures.tender.CASH ?? 0, creditMinor: figures.tender.CREDIT ?? 0,
  momoMinor: figures.tender.MOMO ?? 0, cardMinor: figures.tender.CARD ?? 0,
  bankTransferMinor: figures.tender.BANK_TRANSFER ?? 0,
  changeMinor: figures.changeMinor, cashInMinor: totals.cashInMinor,
  cashOutMinor: totals.cashOutMinor,
  expectedCashMinor: serverExpected, countedCashMinor: payload.countedCashMinor,
  varianceMinor: variance,
}, executor)
```

`insertShiftReport` uses `onConflictDoNothing({ target: shiftReport.shiftId })` so a retried close
cannot duplicate. `closeShift` already requires `status = 'OPEN'` under a row lock, so a second close
is a 409 before it gets here; the conflict clause is the belt to that braces.

There is **no** update function for `shift_report` in the repository, and the plan adds none. A test
grep-level assertion: `grep -c "update(shiftReport)" api/src == 0`.

### 3. The read endpoints

`pos.routes.ts` (the authenticated module routes, not the device ones) is joined by two device routes
in `sync.routes.ts`:

| Route | Behaviour |
|---|---|
| `GET /api/pos/shifts/:id/report?kind=Z` | requires the shift to be `CLOSED`; returns the snapshot. A missing snapshot is a **500 with a code** (`SHIFT_REPORT_MISSING`), not a recomputation — a report that can be rebuilt on read is not a snapshot. |
| `GET /api/pos/shifts/:id/report?kind=X` | requires the shift to belong to this terminal and to be `OPEN` or `CLOSED`; computes the same figures live and returns them with `generatedAt`. Writes nothing. |

Both are `requireDeviceJwt`, `max: 60/min` per device, and both scope by `device.terminalId`.

`XReportView` and `ZReportView` share one DTO shape; `Z` additionally carries `countedCashMinor` and
`varianceMinor` and is immutable.

### 4. The nightly payment sweep

`POS_PAYMENT_RECONCILE_QUEUE`, `boss.schedule(…, '20 1 * * *', null, { tz: 'Africa/Accra',
missed: 'once' })`:

```ts
const stale = await findStalePending(olderThanMinutes(10), 200)
for (const payment of stale) {
  try { await refreshPaymentById(payment.id) }           // same path as GET ?refresh=1
  catch (error) { logger.warn({ paymentId: payment.id }, 'payment reconcile failed') }
}
```

Idempotent by construction: `refreshPaymentById` only acts on `PENDING`, and
`last_verified_at` throttles it. A payment already `PAID` by webhook is skipped without a call.

The worker returns `{ checked, settled, failed }` and logs the summary.

### 5. Tests (`pos.report.test.ts`)

Fixture: one open shift, two cash sales (one with change), one three-tender sale, one refund with a
`RESALABLE` line, one void, one `CASH_IN`, one `CASH_OUT`.

- close → one `shift_report`, and **every** column equals an independent recomputation written in the
  test with plain SQL (not by calling the same function);
- `net = gross − refunds`; `cash_minor` equals the sum of cash tenders, **not** net of change, and
  `change_minor` is reported separately;
- `expected_cash = opening_float + cash − change + cash_in − cash_out`, and
  `variance = counted − expected`, matching `computeExpectedCash`;
- the report's `momo_minor`/`card_minor` equal the electronic tenders and exclude cash and credit;
- an X-report taken **before** close equals the Z figures except `generatedAt` and the counted/variance
  pair; an X-report after close still equals the snapshot;
- X writes nothing: assert `SELECT COUNT(*) FROM shift_report` before and after;
- a `Z` request for an open shift → 409; for a closed shift with the snapshot deleted by hand (test
  only) → 500 `SHIFT_REPORT_MISSING`;
- a second close attempt → 409 and still one report row;
- `reconcileShifts` reports **zero** problems for the shift (Phase 12's check must not regress);
- the nightly sweep settles a mock payment that the webhook never delivered, and leaves a `PAID` one
  untouched (assert the mock call counter).

### 6. One measurement

Add `EXPLAIN (ANALYZE, BUFFERS)` for `selectShiftReportFigures` on the seeded demo month, in a
comment in the plan's commit message. If it seq-scans `sale`, say so and add
`index('sale_shift_idx')` only if it is missing — it exists (`pos.schema.ts`), so the expected outcome
is that **no index is added**, and the figure is recorded.

## Verification

```bash
bun run --filter api test
bun run check-types
bun run lint
```

Expected: API **~725 → ~745**. Desktop untouched until Plan 11 prints the report.

## Commits

1. `feat(api): one aggregate for a shift's whole money picture`
2. `feat(api): shift close writes an immutable Z-report snapshot`
3. `feat(api): X and Z report endpoints, scoped to the terminal`
4. `feat(api): a nightly sweep reconciles stranded pending payments`
5. `test(api): every report figure recomputed by hand`

## Done when

- A closed shift has a Z-report nobody can edit and everybody can recompute.
- An X-report can be asked for as often as a manager likes and leaves no trace.
- A payment whose webhook never arrived is settled by the sweep, once.
