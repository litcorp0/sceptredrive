---
phase: 09-analytics-dashboard
plan: 02
title: Analytics module core and GET /api/analytics/overview
lane: api
depends_on: [01]
requirements: [ADM-02, ANL-01, ANL-02, ANL-03]
---

# Plan 02 — Analytics module core and the overview read model

## Goal

`GET /api/analytics/overview` returns one bounded, branch-correct, integer-only payload
containing everything the executive dashboard needs, computed in a single read-only
snapshot, with a manager unable to obtain another branch's numbers.

## Read first

- `api/src/modules/pos/pos.schema.ts:105-307` — sale, sale_line, sale_tender, shift,
  sync_conflict.
- `api/src/modules/pos/pos.service.ts:766-1300` — what a sale actually stores.
- `api/src/modules/inventory/inventory.repository.ts:104-129` — the `mapWith(Number)`
  convention for aggregates.
- `api/src/modules/payables/payables.repository.ts:593-627` — grouped `SUM` with `CASE`.
- `api/src/auth/scope.ts`, `api/src/http/authorize.ts`, `api/src/http/validation.ts`,
  `api/src/http/rate-limit.ts`, `api/src/http/errors.ts`.
- `api/src/app.ts:36-64` — global middleware and route mounting order.
- `00-DECISIONS.md` P9-D1, P9-D2, P9-D5, P9-D6, P9-D7, P9-D10, P9-D11.

## Files

```
api/src/modules/analytics/
  analytics.types.ts
  analytics.schema.ts      # exports {} — this module owns no tables; comment says why
  analytics.validation.ts
  analytics.repository.ts
  analytics.service.ts
  analytics.controller.ts
  analytics.routes.ts
  analytics.test.ts
```

## Tasks

### 1. Types (`analytics.types.ts`)

Declare the response contract, all money as `…Minor: number`:

```ts
export type Granularity = 'day' | 'week' | 'month'

export interface AnalyticsQuery {
  from: string; to: string; granularity: Granularity; branchId?: string
}

export interface MoneyDelta {
  currentMinor: number
  previousMinor: number
  /** null when the previous period is zero — never Infinity, never 0. */
  deltaBp: number | null
}

export interface SeriesPoint {
  /** "2026-10-24" — calendar day in Africa/Accra. */
  bucketStart: string
  takeMinor: number
  taxTotalMinor: number
  salesCount: number
}

export interface TaxSplit {
  baseMinor: number; vatMinor: number; nhilMinor: number; getfundMinor: number; totalMinor: number
}
```

`OverviewResponse` carries:

- `period` (`from`, `to`, `granularity`, `days`), `comparison` (`from`, `to`),
  `currency: 'GHS'`.
- `scope: { branchIds: string[]; branchCount: number; allBranches: boolean }`.
- `totals`: `takeMinor`, `revenueBaseMinor`, `grossProfitMinor`, `marginBp: number | null`,
  `tax: TaxSplit`, `salesCount`, `avgBasketMinor`, `itemsSold`, `changeMinor`,
  `cashMinor`, `electronicMinor`, `creditMinor`,
  `refundsMinor: 0`, `refundCount: 0` (reserved, P9-D11 — say so in the comment).
- `deltas`: `take`, `grossProfit`, `salesCount`, `avgBasket` (`MoneyDelta`), plus
  `marginBpDelta: number | null`.
- `series: SeriesPoint[]`.
- `tenderMix: { method: string; amountMinor: number }[]` — `CASH` derived, `CREDIT`, plus any
  other `sale_tender` method.
- `topProducts: TopProduct[]` (limit ≤ 10), `categorySplit: CategorySlice[]`
  (top 4 + `OTHER`), `branchRanking: BranchRank[]` (empty for managers).
- `attention`: `lowStockCount`, `openConflictCount`, `conflictsBySeverity`,
  `openShiftCount`, `overLimitCreditCount`, `expiringPoints`, `expiringPointsValueMinor`.
- `syncHealth`: `activeTerminals`, `terminalsSeenToday`, `revokedDevices30d`,
  `avgUploadLagMinutes`, `maxUploadLagMinutes`.
- `driftMinor: { revenue: number; tax: number }` (P9-D5).

`TopProduct` carries `productId`, `sku`, `name`, `quantity`, `revenueBaseMinor`,
`costMinor`, `grossProfitMinor`, `marginBp`. `CategorySlice` carries `categoryId | null`,
`name`, `revenueBaseMinor`, `quantity`. `BranchRank` carries `branchId`, `code`, `name`,
`takeMinor`, `salesCount`.

No customer name, phone, email, or address appears anywhere in this file.

### 2. Validation (`analytics.validation.ts`)

```ts
const analyticsQuery = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  granularity: z.enum(['day', 'week', 'month']).default('day'),
  branchId: z.uuid().optional(),
}).strict()

export const validateOverviewQuery = validateQuery(analyticsQuery)
```

`from ≤ to` and the 366-day cap are service rules (they need "today in Accra"), so they
throw `ValidationError` with a sentence a user can read, not a Zod message.

### 3. Repository (`analytics.repository.ts`)

Header comment records P9-D10 (sibling `*.schema.ts` imports only, no sibling repositories,
no re-implemented domain rules).

Every function takes a scope descriptor and a half-open window:

```ts
interface Window { from: Date; to: Date }
interface Scope { branchIds: string[] | null }   // null = all branches
```

Implement:

- `selectHeaderTotals(scope, window)` — `count(*)` cast to int, `SUM(total_minor)`,
  `SUM(vat_minor)`, `SUM(nhil_minor)`, `SUM(getfund_minor)`, `SUM(tax_total_minor)`,
  `SUM(change_minor)`, `SUM(credit_amount_minor)`, `SUM(loyalty_discount_minor)`.
- `selectLineTotals(scope, window)` — join `sale_line` → `sale`; `SUM(base_minor)`,
  `SUM(unit_cost_minor * quantity)`, `SUM(quantity)`.
- `selectSeries(scope, window, granularity)` — `date_trunc($granularity, occurred_at, 'UTC')`
  grouped, then gap-filled in SQL with `generate_series` (`LEFT JOIN` so empty buckets are
  zero). Return `bucketStart` as `to_char(..., 'YYYY-MM-DD')`.
- `selectTenderBreakdown(scope, window)` — `SUM(credit_amount_minor)`, `SUM(total_minor)`,
  and `SELECT method, SUM(amount_minor) … WHERE method <> 'CASH' GROUP BY method`.
- `selectTopProducts(scope, window, limit)` — group by `product_id`, join `product` for
  `sku`/`name`; order by `revenueBaseMinor` desc, then quantity desc; `limit` clamped to 50.
- `selectCategorySplit(scope, window)` — group by `category_id`, join `category`; service
  folds the tail into `OTHER`.
- `selectBranchRanking(scope, window)` — group by `branch_id`, join `branch`; admin only.
- `selectAttention({ lowStock, openConflicts, openShifts, overLimitCredit, expiring })` —
  five small counts using existing indexes/projections:
  - low stock: `stock_level` joined to `stock_threshold` where
    `quantity_on_hand <= threshold` and `threshold > 0`.
  - open conflicts: `sync_conflict` where `status = 'OPEN'`, grouped by severity.
  - open shifts: `shift` where `status = 'OPEN'`.
  - over-limit credit: `credit_profile` where `limit_minor > 0 AND balance_minor > limit_minor`.
  - expiring: `loyalty_lot` where `remaining_points > 0 AND expires_at < now + 30 days`.
    Value it with `loyalty.pointsPerCedi` via `getSettingValue`, matching
    `loyalty.service.ts:479-519` semantics (do not invent a second formula — call the
    setting and reuse `Math.floor` over points × 100 / pointsPerCedi).
- `selectSyncHealth(scope, window)` — active terminals, terminals with `last_seen_at` today,
  revoked devices in `window`, and `AVG/MAX(received_at − occurred_at)` in seconds.

Rules: `inArray('sale.branch_id', branchIds)` when scoped; always
`.mapWith(Number)` on aggregates; no string interpolation of values; no `SELECT *` into
JSON.

### 4. Service (`analytics.service.ts`)

```ts
export async function getOverview(user: SessionUser, query: AnalyticsQuery): Promise<OverviewResponse>
```

1. `scope = resolveBranchFilter(user, query.branchId)` → `null` (admin, all) or a single
   branch id. A manager passing a foreign id already throws `ForbiddenError`.
2. `const period = resolvePeriod(query)` — parse `from`/`to` as UTC midnights; `to` is
   clamped to `accraIsoDay()` (a future `to` is clamped, not rejected); `from > to` and
   span > 366 throw `ValidationError`; `comparison` is the immediately preceding window of
   equal length.
3. Run every query inside one snapshot:

   ```ts
   const rows = await db.transaction(async (tx) => {
     await tx.execute(sql`set local statement_timeout = '3000ms'`)
     const [current, previous, series, tender, products, categories, ranking, attention, sync] =
       await Promise.all([...])   // all on tx
     return {...}
   }, { isolationLevel: 'repeatable read', accessMode: 'read only' })
   ```

   `Promise.all` inside one transaction is safe: node-postgres queues the statements on the
   single connection, and they share the snapshot.
4. Derive in integer arithmetic only:
   - `cashMinor = max(0, takeMinor − electronicMinor − creditMinor)`; if the three do not sum
     to `takeMinor`, that is a bug — `console.error` is forbidden, so throw a 500
     `AppError('ANALYTICS_INCONSISTENT', …)` and let the test suite catch it first.
   - `avgBasketMinor = salesCount === 0 ? 0 : Math.round(takeMinor / salesCount)`.
   - `marginBp = ratioBp(grossProfitMinor, revenueBaseMinor)`.
   - deltas via `deltaBp`; `marginBpDelta` is a plain integer difference of two nullable
     basis points, null when either is null.
   - `driftMinor.revenue = takeMinor − tax.totalMinor − revenueBaseMinor`;
     `driftMinor.tax = tax.totalMinor − Σ line tax`. Line tax comes from
     `selectLineTotals` (add `SUM(tax_total_minor)` there).
5. `branchRanking` is `[]` when `user.role !== 'ADMIN'`; `scope.allBranches` is
   `scope === null`.

Keep the four derived invariants in named functions so tests can call them directly.

### 5. Controller + routes

`analytics.controller.ts`:

```ts
export async function getOverview(c: Context<AppEnv>, query: OverviewQuery) {
  const user = currentUser(c)
  return c.json(await analyticsService.getOverview(user, query))
}
```

`analytics.routes.ts`: `factory.createApp()`, then

```ts
analyticsRoutes.get(
  '/api/analytics/overview',
  requireSession,
  requirePermission('analytics.read'),
  rateLimit({ windowMs: 60_000, max: 120, keyPrefix: 'analytics', keyForRequest: (c) => currentUser(c).id }),
  validateOverviewQuery,
  (c) => analyticsController.getOverview(c, c.req.valid('query')),
)
```

Mount in `api/src/app.ts` before the `notFound` handler (import + one
`app.route('/', analyticsRoutes)` line).

### 6. Tests (`analytics.test.ts`)

Follow `api/src/modules/pos/pos.test.ts`: `databaseAvailable()`, `describe.skipIf`, one
branch (retail), a second branch, a terminal + device per branch, a cashier, a shift, and a
local `executeSale` helper calling `applySale` with `receivedAt = occurredAt` so no
`CLOCK_SKEW` is raised. Guard the demo DB by branching on unique codes with `randomToken`.

Required cases:

1. **Reconciles to the ledger** — three sales across two days and two branches:
   `totals.takeMinor` equals `Σ sale.total_minor` for the window; `series` sums to
   `totals.takeMinor`; `tenderMix` sums to `totals.takeMinor`; `tax` equals the header sums;
   `revenueBaseMinor` equals `Σ sale_line.base_minor`; `grossProfitMinor` equals
   `revenueBaseMinor − Σ(unit_cost_minor × quantity)`; `itemsSold` equals `Σ quantity`.
2. **Manager scope** — manager session, no `branchId`: sees only their branch.
   `?branchId=<other>` → **403**, not an empty payload. Admin with the same id → 200.
3. **Period rules** — `from > to` → 400 `VALIDATION_ERROR`; span 367 days → 400; `to` in the
   future is clamped to today; `granularity=quarter` → 400.
4. **Gap-filled series** — a period with sales on day 1 and day 5 and none between returns
   five points with zeros in between, `bucketStart` values as `YYYY-MM-DD`.
5. **Empty period** — zeros, `series` length = bucket count, deltas are `null` when the
   previous window is empty.
6. **No PII** — serialise the response and assert it contains no customer phone/name from
   the fixtures (a coarse `expect(JSON.stringify(body)).not.toContain(phone)` is enough).
7. **Drift** — a sale inserted with `TOTAL_MISMATCH` semantics (header total deliberately
   different from line totals, as `applySale` stores it) yields non-zero `driftMinor`.

## Verification

```bash
bun run --filter api test -- analytics
bun run --filter api check-types
bun run --filter api lint
bun run check-types
```

Expected: new suite green in isolation and in the full API run (360 → ~372). No other
module's test changes.

## Commits

1. `feat(api): analytics module core with period, scope, and read-only snapshot`
2. `feat(api): analytics overview read model and route`
3. `test(api): reconciliation, branch-scope, and period tests for analytics`

## Done when

- `GET /api/analytics/overview` answers 200 for admin and manager, 403 for a manager's
  foreign branch, 400 for an impossible period.
- Every figure traces to one field and reconciles to `sale`, `sale_line`, or `sale_tender`.
- Queries run read-only in one snapshot with a 3 s statement timeout.
- Rate limited, permission-checked, and free of customer identity.
