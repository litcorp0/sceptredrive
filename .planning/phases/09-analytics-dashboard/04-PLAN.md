---
phase: 09-analytics-dashboard
plan: 04
title: Inventory, credit, loyalty, and payables read models
lane: api
depends_on: [03]
requirements: [ADM-02, ANL-02]
---

# Plan 04 — Inventory, credit, loyalty, payables

## Goal

The four remaining tabs answer "what is the stock worth, who owes us, what is loyalty going
to cost, and what do we owe suppliers" from server aggregates that reconcile to the ledgers,
without exposing a single customer identity.

## Read first

- `api/src/modules/inventory/inventory.service.ts:479-579` — valuation is `qty × avg_cost`
  in JS today; nothing sums it branch-wide.
- `api/src/modules/credit/credit.service.ts:609-667` and `credit.repository.ts:276-284` —
  the existing ageing report is a full-ledger read plus JS FIFO; do not copy it, do not
  re-implement the ageing rule.
- `api/src/modules/loyalty/loyalty.service.ts:343-400,479-519` — expiry and liability.
- `api/src/modules/payables/payables.service.ts:757-875` — balances and ageing.
- `00-DECISIONS.md` P9-D10 (read-model boundary).

## Scope decisions

- **RPT-04 (stock report with movements, transfers, counts) and RPT-05 (credit/payables
  ageing) are Phase 14.** This plan delivers trends, totals, and distribution, not the
  full report screens.
- **No customer rows.** Credit shows distribution buckets only (D15). Loyalty shows flows
  and totals. Payables shows suppliers (a business entity, not a customer).

## Tasks

### 1. `GET /api/analytics/inventory`

- `totals`: `stockValueMinor` = `Σ (stock_level.quantity_on_hand * stock_level.avg_cost_minor)`
  computed in SQL with `SUM(quantity_on_hand::bigint * avg_cost_minor)` and
  `.mapWith(Number)`; `unitsOnHand`, `distinctProducts`, `lowStockCount`,
  `outOfStockCount` (`quantity_on_hand <= 0`), `thresholdCount`.
- `byBranch` (admin only): value, units, low-stock count per branch.
- `flow`: per bucket, `{ bucketStart, receivedUnits, soldUnits, adjustedUnits,
  transferredInUnits, transferredOutUnits, receivedValueMinor }` from
  `stock_movement` grouped by `type`, gap-filled. Note `stock_movement` has **no
  `occurred_at`** (`inventory.schema.ts:45-72`); bucket on `created_at` and say so in the
  field comment ("ledger posting time, not business date").
- `topMovers`: top 10 products by `−Σ quantity_delta` where `type = 'SALE'`.
- `deadStock`: count of product/branch rows with `quantity_on_hand > 0` and no movement in
  the window (a count only; the list belongs to Phase 14).

### 2. `GET /api/analytics/credit`

- `totals`: `outstandingMinor` = `Σ credit_profile.balance_minor`; `limitMinor` =
  `Σ credit_profile.limit_minor`; `utilisationBp` = `ratioBp(outstanding, limit)`;
  `customersWithBalance`, `overLimitCount`, `onHoldCount`,
  `overLimitExposureMinor` = `Σ max(0, balance − limit)`.
- **Cross-check field:** `ledgerBalanceMinor` = `Σ credit_ledger_entry.amount_minor` for the
  same scope. `reconcileDriftMinor = outstandingMinor − ledgerBalanceMinor`. The response
  includes it; the test asserts zero. This is the append-only property made visible.
- `series`: `{ bucketStart, chargesMinor, repaymentsMinor, netMinor }` from
  `credit_ledger_entry` grouped by `kind` (CHARGE positive, REPAYMENT/REFUND negative,
  ADJUSTMENT signed as stored).
- `distribution`: buckets `{ label, count, balanceMinor }` for
  `0–50%`, `50–80%`, `80–100%`, `>100%` utilisation, computed in integer arithmetic
  (`limit_minor = 0` rows group into `NO_LIMIT`).
- `byBranch` (admin only): outstanding, limit, over-limit count.
- No customer id, name, phone, or per-customer row in the payload.

### 3. `GET /api/analytics/loyalty`

- `totals`: `issuedPoints`, `redeemedPoints`, `expiredPoints`, `adjustedPoints` from
  `loyalty_ledger_entry` by `kind` in the window; `outstandingPoints` and
  `outstandingValueMinor` **from `loyalty.service.getLiability` semantics** — call the
  service (or a narrow new export on it) rather than writing a second valuation; if the
  service signature makes that awkward, add `sumOutstandingPoints()` to the loyalty service
  and call it, do not duplicate the `pointsPerCedi` maths in analytics.
- `expiringSoon: { points, valueMinor, days: 30 }`.
- `series`: `{ bucketStart, issuedPoints, redeemedPoints, expiredPoints }`.
- `earnRate`: `{ pointsPerCedi, earnPointsPerCedi, expiryMonths }` read from settings, so
  the chart legend can explain the programme without hard-coding it.
- `byBranch` (admin only) — reuse the existing `branchActivity` shape/route? That endpoint
  already exists at `/api/loyalty/liability`; the analytics tab may show the same numbers.
  Call the loyalty service rather than duplicating its `CASE` sums.

### 4. `GET /api/analytics/payables`

- `totals`: `outstandingMinor` = `Σ (total_minor − amount_paid_minor)` where
  `status IN ('OPEN','PARTIAL')`; `paidMinor` = `Σ supplier_payment.amount_minor` where
  `status = 'COMPLETED'` in the window; `overdueMinor` = outstanding where
  `due_date < today(Accra)`; `invoicedMinor`, `onAccountMinor` (completed payments minus
  signed allocations, matching `selectOnAccountBySupplier`).
- `series`: `{ bucketStart, invoicedMinor, paidMinor }`.
- `topSuppliers`: `{ supplierId, code, name, outstandingMinor, overdueMinor }` (≤ 10).
- `overdueBuckets`: `current`, `days1To30`, `days31To60`, `days61To90`, `over90` — computed
  with the **same** `payableAging`/`bucketPayableDaysPastDue` logic
  (`payables.service.ts:713-750`). Export those two functions or call a new small
  `getAgingTotals(scope)` on payables; do not fork the boundaries.
- Ageing screens stay in Phase 14; this tab shows totals and a trend.

### 5. Attention + sync queries

Move the overview's attention queries (Plan 02) into named repository functions shared by
`overview`; add nothing new here. Add `selectSyncHealth` tests.

### 6. Tests

1. Inventory value equals `Σ qty × avg_cost` computed independently in the test from the
   fixture, and `byBranch` sums to the total.
2. Credit: `outstandingMinor === ledgerBalanceMinor` (drift 0) after a CHARGE and a
   REPAYMENT through the credit service; distribution counts add up to
   `customersWithBalance`.
3. Loyalty: after an EARN and a REDEEM through the loyalty service, `issuedPoints =
   redeemedPoints =` the values posted; `outstandingValueMinor` matches
   `/api/loyalty/liability` for the same scope.
4. Payables: after an invoice and a partial payment through the payables service,
   `outstandingMinor = total − paid`, `paidMinor` equals the payment, and the overdue bucket
   logic matches `/api/payables/aging` totals for the same scope.
5. Each endpoint: manager scope enforced (403 on a foreign branch), no customer PII in the
   serialised body.

## Verification

```bash
bun run --filter api test -- analytics
bun run --filter api check-types
bun run --filter api lint
```

## Commits

1. `feat(api): inventory valuation and movement read model`
2. `feat(api): credit and loyalty analytics read models`
3. `feat(api): payables analytics read model`
4. `test(api): ledger reconciliation for inventory, credit, loyalty, and payables`

## Done when

- All eight endpoints exist and share one validation, scope, snapshot, and error shape.
- Every figure reconciles to the ledger or projection that owns it, with a test proving it.
- No domain rule is re-implemented: ageing buckets, liability valuation, and low-stock
  semantics come from the owning service.
- No customer identity in any payload.
