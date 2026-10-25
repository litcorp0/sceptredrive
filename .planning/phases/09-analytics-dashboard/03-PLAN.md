---
phase: 09-analytics-dashboard
plan: 03
title: Sales, products, and tax read models with CSV export
lane: api
depends_on: [02]
requirements: [RPT-01, RPT-02, RPT-03, ANL-03]
---

# Plan 03 — Sales, products, tax, and CSV

## Goal

Three drill-down read models and a server-side CSV export for each, sharing one validation
path, one branch scope, and one serialiser, with formula-injection escaping proven by test.

## Read first

- Plan 02 (module shape, snapshot helper, scope).
- `packages/shared/src/csv.ts` from Plan 01.
- `api/src/modules/payables/payables.repository.ts:593-627` — grouped aggregates.
- `admin/src/modules/payables/pages/payables-aging-page.tsx:33,60` — note: the admin today
  sums ageing buckets client-side; Phase 9 must not repeat that pattern.

## Tasks

### 1. Shared export plumbing (inside the analytics module)

- `analytics.utils.ts` **must not** be created: `AGENTS.md` fixes seven files per module.
  Put the filename builder and CSV assembly in `analytics.service.ts` as small exported
  functions (`buildExportFilename`, `renderCsv`) so routes/controllers stay thin.
- Filename: `sceptre-{report}-{branchCodeOrAll}-{from}-{to}.csv`, lower-case, ASCII only,
  no user-supplied text; branch code comes from `branch.code` after scope resolution.
- Response headers: `content-type: text/csv; charset=utf-8`, `content-disposition:
  attachment; filename="…"`, `cache-control: no-store, private`.

### 2. `GET /api/analytics/sales` (RPT-01)

Query adds `sort`, `direction`, `limit`, `offset`:

```ts
sort: z.enum(['date', 'take', 'count']).default('date'),
direction: z.enum(['asc', 'desc']).default('desc'),
limit: z.coerce.number().int().min(1).max(50).default(20),
offset: z.coerce.number().int().min(0).default(0),
```

Response:

- `totals` — `takeMinor`, `salesCount`, `avgBasketMinor`, `itemsSold`, `changeMinor`, `tax`
  (the same `TaxSplit` shape as overview).
- `series` — the same `SeriesPoint` contract.
- `byBranch` (admin only), `byTerminal`, `byCashier` — each `{ id, label, takeMinor,
  salesCount, taxTotalMinor }`, top 50, ordered by take.
- `byHour` — 24 entries `{ hour: 0..23, takeMinor, salesCount }`, gap-filled in SQL with
  `generate_series(0, 23)`.
- `rows` — the drill-down table: `receiptNumber`, `occurredAt` (ISO), `branchCode`,
  `terminalCode`, `cashierStaffId`, `cashierName`, `takeMinor`, `taxTotalMinor`,
  `salesCount` is not needed per row; include `itemsSold` and `changeMinor`.
  `cashierName` comes from a `LEFT JOIN user ON user.id = sale.cashier_user_id`; fall back
  to `cashier_staff_id` so a deleted user cannot produce `null` in a labelled column.
- `total` — the count before `limit`, for the existing `Pagination` component.

Sorting is server-side and allow-listed; never interpolate a client string into SQL.

### 3. `GET /api/analytics/products` (RPT-03)

Query adds `sort: 'revenue' | 'units' | 'margin'` (default `revenue`), `direction`,
`limit ≤ 50`, `offset`, `categoryId?` (uuid).

Response:

- `totals` — `revenueBaseMinor`, `costMinor`, `grossProfitMinor`, `marginBp`, `unitsSold`,
  `distinctProducts`.
- `rows` — `productId`, `sku`, `name`, `quantity`, `revenueBaseMinor`, `costMinor`,
  `grossProfitMinor`, `marginBp`, `salesCount` (distinct sales containing the product).
- `top: TopProduct[]` (≤ 10) and `concentration`: `{ top5RevenueBp: number | null }` —
  share of revenue held by the five best sellers, computed in integer arithmetic.
- `byCategory` — `CategorySlice[]` (top 4 + `OTHER`).

Invariant to test: `Σ rows.revenueBaseMinor` (for the whole window, not the page) equals
`overview.totals.revenueBaseMinor` for the same period and scope.

### 4. `GET /api/analytics/tax` (RPT-02)

Response:

- `totals` — `TaxSplit` from header columns, plus `taxableSalesMinor` (the inclusive total
  of `STANDARD` lines) and `salesCount`.
- `byBranch` (admin only) — `{ branchId, code, baseMinor, vatMinor, nhilMinor,
  getfundMinor, totalMinor }`.
- `byCategory` — from `sale_line.tax_category`: `{ category: 'STANDARD' | 'ZERO_RATED' |
  'EXEMPT', baseMinor, vatMinor, nhilMinor, getfundMinor, totalMinor, revenueBaseMinor }`.
- `series` — `{ bucketStart, vatMinor, nhilMinor, getfundMinor, totalMinor }`.
- `driftMinor` — header tax minus line tax (P9-D5); response also carries
  `driftExplanation: 'Header totals are the charged amounts; line totals are the server
  recomputation. They differ only for sales stored with TOTAL_MISMATCH.'`
- `rates`: `{ vatBp: 1500, nhilBp: 250, getfundBp: 250, source: 'packages/shared/src/tax.ts' }`
  — read from the constants, never retyped.

### 5. Exports

```
GET /api/analytics/sales/export
GET /api/analytics/products/export
GET /api/analytics/tax/export
```

- Same `requireSession`, `requirePermission('analytics.read')`, scope, and validation as the
  JSON route; rate limit `20/min` with `keyPrefix: 'analytics-export'`.
- Same service function, then `renderCsv`:
  - sales: one row per sale (`receipt`, `occurred_at`, `branch`, `terminal`, `cashier`,
    `take_minor`, `tax_minor`, `change_minor`, `items`).
  - products: one row per product in the window (not just the page).
  - tax: one row per granularity bucket plus a final `TOTAL` row.
- Money columns are **raw integer pesewas** with the header naming them `…_minor`. The CSV
  is data, not a receipt; a spreadsheet can divide. Say so in the first comment row? No —
  keep the file machine-clean and document the convention in the API doc comment and the
  button's tooltip ("Amounts are in pesewas").
- BOM on, CRLF, `csvCell` from `@sceptre/shared`.

### 6. Tests

Extend `analytics.test.ts` (or add `analytics.reports.test.ts` if it grows past ~400 lines;
keep the seven-file module rule — test files are exempt):

1. `sales` totals equal `overview` totals for the same window; `Σ series = totals.takeMinor`;
   `byHour` has exactly 24 entries; rows paginate and `total` is stable across pages.
2. `sales` sort allow-list: `?sort=take&direction=asc` orders correctly; `?sort=drop_table`
   → 400.
3. `products`: `Σ rows.revenueBaseMinor = overview.totals.revenueBaseMinor`;
   `grossProfitMinor = revenueBaseMinor − costMinor`; `marginBp = ratioBp(profit, revenue)`;
   a product with zero cost yields `marginBp = 10000`.
4. `tax`: `Σ byCategory.baseMinor = totals.baseMinor`; for a fixture with one `ZERO_RATED`
   and one `EXEMPT` line, those lines carry zero VAT/NHIL/GETFund and full base.
5. **CSV injection**: create a product named `=1+2` and a category named `@SUM(A1)`; the
   products export contains `"'=1+2"` and `"'@SUM(A1)"` and never a bare leading `=`.
6. **Export scope**: a manager exporting with a foreign `branchId` gets 403; a manager's
   export contains only their branch's rows.
7. **Headers**: `content-type` starts `text/csv`, the body starts with `\uFEFF`, lines end
   `\r\n`, and the filename matches the reported period and branch code.

## Verification

```bash
bun run --filter api test -- analytics
bun run --filter api check-types
bun run --filter api lint
```

## Commits

1. `feat(api): sales and product performance read models`
2. `feat(api): tax read model with header/line drift`
3. `feat(api): server-side CSV exports for sales, products, and tax`
4. `test(api): reconciliation and CSV injection coverage for analytics reports`

## Done when

- Three JSON endpoints and three export endpoints answer with the same scope and validation.
- Every money field is an integer; every ratio is basis points or `null`.
- A malicious product name cannot produce an executable formula in Excel.
- `Σ rows` for the unpaged report equals the overview figure for the same window.
