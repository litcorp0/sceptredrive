---
phase: 09-analytics-dashboard
plan: 05
title: seed:demo-sales — a realistic month through the service layer
lane: api
depends_on: [04]
requirements: [ADM-02, ANL-02]
---

# Plan 05 — Demo month of sales

## Goal

`bun run seed:demo-sales` produces six weeks of realistic, reconcilable trading across two
retail branches so the dashboard and every analytics tab can be reviewed locally without a
terminal. It is idempotent, refuses production, and writes only through `applySale` so no
ledger can disagree with a sale.

## Read first

- `api/src/seed/demo.ts` (804 lines) — existing demo data, idempotency style, the terminal,
  products, customers, and device binding already present.
- `api/src/seed/run.ts` — CLI shape and the `NODE_ENV=production` guard.
- `api/src/modules/pos/pos.service.ts:766-1300` — `applySale`, the context, and the clock
  skew rule (`receivedAt − occurredAt`).
- `api/src/modules/pos/pos.test.ts:490-520` — the `executeSale` helper this seed mirrors.
- `packages/shared/src/pos.ts:145-255` — `priceCart` output; the payload totals map from it
  one-to-one.

## Files

```
api/src/seed/demo-sales.plan.ts   # pure: days × branches × terminals → sale plan (no DB)
api/src/seed/demo-sales.ts        # writer: branches, terminals, devices, shifts, applySale
api/src/seed/demo-sales.run.ts    # CLI, production guard, summary print
api/src/seed/demo-sales.test.ts   # planner unit tests + optional DB reconciliation
```

`api/src/seed/index.ts` exports `seedDemoSales` alongside `seedAdmin`/`seedDemo`.

`NEEDS_LANE_CHANGE` → controller adds to root `package.json`:
`"seed:demo-sales": "bun run --filter api seed:demo-sales"`, and to `api/package.json`:
`"seed:demo-sales": "bun run src/seed/demo-sales.run.ts"`.

## Design

### Planner (`demo-sales.plan.ts`) — pure, deterministic

```ts
export interface DemoPlanOptions {
  endDay: string        // "2026-10-24" (Accra)
  days: number          // 42
  seed: number          // 20261024
  branches: Array<{ code: string; name: string; city: string; terminals: string[] }>
  products: Array<{ id: string; priceMinor: number; costMinor: number; taxCategory: TaxCategory }>
  customers: Array<{ id: string; kind: 'CASH' | 'CREDIT'; loyalty: boolean }>
}

export interface PlannedSale {
  branchCode: string
  terminalCode: string
  day: string
  occurredAt: string
  lines: Array<{ productId: string; quantity: number; unitPriceMinor: number }>
  tender: 'CASH' | 'CREDIT'
  customerId: string | null
  loyaltyRedeemPoints: number
  cashTenderedMinor: number
  receiptNumber: string
}
```

`mulberry32(seed)` for repeatability (no `Math.random`). Rules:

- Weekday shape: 9–18 sales/day/terminal on weekdays, 14–26 on Fri/Sat; a lunchtime bump
  (11:00–14:00) and an evening bump (16:00–18:00); no sales on Sunday after 15:00.
- 1–4 lines per sale, quantities 1–3, drawn from the product list with a Pareto-ish skew so
  top sellers exist.
- 12% of sales are credit against a credit customer; 20% of cash sales attach a loyalty
  customer and redeem points on every fifth such sale.
- `cashTenderedMinor` rounds up to the next GHS 10/20/50 note so `changeMinor > 0` exists
  and the tender-mix derivation is exercised.
- Receipt numbers `DEMO-<branchCode>-<YYYYMMDD>-<NN>`; `clientTransactionId` is a
  deterministic UUID v5-style string derived from `(branch, terminal, day, index)` so reruns
  would collide rather than duplicate.

### Writer (`demo-sales.ts`)

1. Refuse when `NODE_ENV === 'production'` (same message style as `run.ts`).
2. Idempotency: if `SELECT count(*) FROM sale WHERE receipt_number LIKE 'DEMO-%'` > 0, print
   "already present" and return `{ created: [] }`. Never delete rows to make room.
3. Ensure demo infrastructure, creating only what is missing (match by code):
   - retail branch `KUM-ASO` (Kumasi) and terminals `KUM-ASO-T01`, `KUM-ASO-T02`;
   - a second terminal on the existing `ACC-SPX` branch: `ACC-SPX-T02`;
   - one `device` per terminal (fingerprint `demo-sales-<code>`, random `tokenHash`, status
     `ACTIVE`);
   - `pos_staff_binding` for the demo cashier on each device (a dead binding would raise
     `STALE_CREDENTIALS` on every sale);
   - generous credit profiles (`limit_minor` 500_000) for the credit customers used, and
     loyalty accounts for loyalty customers — created only if absent.
4. For each terminal and each day: open a shift at 08:00 via `openShift`, apply that day's
   planned sales, then `closeShift` with `counted = server expected` so variance is zero.
5. For each sale:

   ```ts
   const priced = priceCart({ lines, taxMode, saleDiscount: null, loyalty: ... })
   const payload: SalePayload = {
     receiptNumber,
     shiftId,
     cashier: { userId, staffId, bindingId, bindingToken, pinVersion },
     customer: customerId ? { id: customerId, phone } : null,
     lines, // with taxCategory from the product
     saleDiscount: null,
     loyalty: redeemPoints ? { redeemPoints, earnPreviewPoints: earnPreview(...) } : null,
     tenders: [{ method: tender, amountMinor: tender === 'CREDIT' ? priced.totalMinor : cashTenderedMinor }],
     totals: { ...priced, changeMinor: tender === 'CASH' ? cashTenderedMinor - priced.totalMinor : 0 },
     occurredAt,
     appVersion: 'seed',
   }
   const context: SaleContext = {
     clientTransactionId, device: { deviceId, terminalId, branchId },
     receivedAt: new Date(occurredAt),      // equal ⇒ no CLOCK_SKEW
     clockSkewToleranceMinutes: 999_999,
   }
   await db.transaction((tx) => applySale(context, payload, tx))
   ```

   If `applySale` throws, abort the run with the receipt number in the message: a seed that
   silently skips a sale would leave the demo month short and the reconciliation test lying.

6. Print `{ created: ['branches 1', 'terminals 3', 'shifts 84', 'sales 1,412'] }`.

### Why through `applySale`

It is the only path that writes sale, line, tender, stock movement, credit ledger, loyalty
ledger, and the shift totals together. Inserting rows directly would satisfy the charts and
break the promise that the dashboard reconciles to the ledgers.

## Tests

Planner (no DB):

- same seed + options → deep-equal plan twice (determinism);
- every `occurredAt` is inside 08:00–19:00 on its planned day; no Sunday evening sales;
- 10–30% of sales are credit; every credit sale names a credit customer;
- cash tendered ≥ total and change is a multiple of 50 minor (GHS 0.50) or zero.

Integration (skipped when the DB is unavailable, uses a scratch suffix and its own branch
codes so it never touches the real demo month):

- a 3-day plan applied twice: the second run reports "already present" and the sale count is
  unchanged;
- after the run, `GET /api/analytics/overview` for the window returns `takeMinor` equal to
  `Σ sale.total_minor` and `driftMinor` both zero;
- `/api/pos/reconciliation` reports no divergence for the seeded branches.

## Verification

```bash
bun run --filter api test -- demo-sales
bun run db:seed -- --demo            # unchanged, still idempotent
bun run seed:demo-sales              # first run creates, second says already present
bun run dev:api &
curl -s 'localhost:4000/api/analytics/overview?from=…&to=…' -b cookie.txt | head -c 400
```

Expected: two runs, unchanged counts; overview non-zero; `driftMinor.revenue === 0` and
`driftMinor.tax === 0` for the demo month; POS reconciliation clean.

## Commits

1. `feat(seed): deterministic demo sales planner`
2. `feat(seed): seed:demo-sales writes a month through applySale`
3. `chore(scripts): expose seed:demo-sales` (controller, root + api package.json)
4. `test(seed): determinism, idempotency, and ledger reconciliation`

## Done when

- One command produces six weeks across two retail branches, and a second run changes nothing.
- Every sale came through `applySale`; stock, credit, loyalty, and shift ledgers agree with
  the sales.
- Production is refused.
- `db:seed --demo` behaviour is unchanged (no new rows, same labels).
