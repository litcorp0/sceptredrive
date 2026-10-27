---
phase: 14-admin-operations-evatu
plan: 05
title: Reports — the stock report, four ageing exports, one audit export
lane: api
depends_on: [02]
requirements: [RPT-04, RPT-05, RPT-06]
---

# Plan 05 — A report reconciles to its ledger or it says which basis it uses

## Goal

The console can obtain a stock report (on-hand, value at average cost, the period's
movements, transfers and counts), a CSV of every ageing and liability report, and an audit
export — each through `packages/shared/src/csv.ts`, each branch-correct, and none of them
rendering a manager's report as a single `TOTAL` row.

## Read first

- `00-DECISIONS.md` P14-D16 to D21, D44.
- `01-RESEARCH.md` facts 3, 26–34, 44–45.
- `api/src/modules/analytics/analytics.service.ts:927-1058` — the four exports whose
  manager behaviour this plan must not copy.
- `api/src/modules/analytics/analytics.controller.ts:58-63` — `sendCsv`.
- `api/src/modules/inventory/inventory.service.ts:545-612` — `toStockRow`, `queryStock`,
  `listStock`, `listLowStock`; `inventory.repository.ts:379-426` — `selectStockPage`.
- `api/src/modules/inventory/inventory.validation.ts:56-66` — the movement filter that
  cannot name `SALE`.
- `api/src/modules/credit/credit.service.ts:719-806`; `credit.routes.ts:80-86`.
- `api/src/modules/payables/payables.service.ts:1029-1132`; `payables.routes.ts:94-100`.
- `api/src/modules/loyalty/loyalty.service.ts:472-522`; `loyalty.routes.ts:29-35`.
- `api/src/modules/platform/audit.service.ts:7-27`, `audit.routes.ts:9-15`.
- `api/src/modules/transfers/transfers.validation.ts:80-100`,
  `counts/counts.validation.ts:31-36` — the lists without a date range.
- `packages/shared/src/csv.ts` and `csv.test.ts`.

## Tasks

### 1. The stock report read model

`api/src/modules/inventory/inventory.report.ts` (a new file in the owning module, following
`pos.reconciliation.ts`'s precedent) plus one route:

`GET /api/inventory/stock/report` under `requirePermission('inventory.read')`, query
`{ branchId?, categoryId?, lowStock?, from?, to? }`, with `resolveBranchFilter`.

Response:

```ts
interface StockReport {
  asOf: string                     // the moment the projection was read
  rows: StockReportRow[]           // product, sku, category, branchCode, quantityOnHand,
                                   // avgCostMinor, valueMinor, threshold, belowThreshold
  totals: { quantityOnHand: number; valueMinor: number; products: number }
  byBranch: Array<{ branchCode: string; branchName: string; quantityOnHand: number; valueMinor: number }>
  movements: { inflow: number; outflow: number; byType: Array<{ type: string; quantity: number }> }
  transfers: { dispatched: number; received: number; shortClosed: number }
  counts: { completed: number; countedLines: number; matchedLines: number; varianceValueMinor: number }
}
```

Rules:

- **Value is the projection, now.** `valueMinor = quantityOnHand × avgCostMinor` from
  `stock_level`, exactly as `analytics.repository.ts:1008-1036` computes it and
  `toStockRow` renders it. No ledger replay, no historical valuation (D16). `asOf` states
  the instant, because a stock figure without one is a rumour.
- **`rows` is paged only by the filter**, not by `limit`: a report is a table, and the
  console paginates in the browser. Cap at 5 000 rows and return `truncated: true` beyond
  it rather than silently dropping rows.
- `byBranch` is populated for an admin only, following `analytics.service.ts:692`'s
  precedent, and `totals` is always the sum of what the caller may see.
- The movement, transfer and count sections use `[from, to)` in Accra days. Counts and
  transfers need `from`/`to` added to their validators (Task 4); the movement query already
  has them.
- `counts.matchedLines` uses the existing accuracy definition
  (`analytics.repository.ts:1187-1232`), not a second one.

### 2. The movement filter stops lying

`inventory.validation.ts:59-61` gains `SALE`, `WRITE_OFF`, `SUPPLIER_RETURN` and `RETURN`
so the report (and the existing stock history screen) can filter what actually moved. The
enum already exists in `inventory.schema.ts:15-31`; this is the validator catching up. A
test asserts every value of the pg enum is accepted at the HTTP boundary, derived from the
shared list rather than hand-copied.

### 3. Exports, each owned by its module

Five routes, all `GET`, all `no-store`, all through `sendCsv`-equivalent headers, all capped
at 50 000 rows:

| Route | Permission | Rows |
|---|---|---|
| `/api/inventory/stock/report/export` | `inventory.read` | the report's product rows + `TOTAL` |
| `/api/credit/aging/export?asOf=&branchId=` | `credit.read` | one row per customer per branch with the six bucket columns + `TOTAL` |
| `/api/payables/aging/export?asOf=&branchId=&supplierId=` | `payable.read` | one row per supplier per branch, buckets, on-account, credit notes + `TOTAL` |
| `/api/loyalty/liability/export?branchId=&from=&to=` | `loyalty.read` | the liability headline rows + per-branch activity + `TOTAL` |
| `/api/audit/export?…same filters as the list…` | `audit.read` | one row per audit entry, **no before/after** |

Filename: `sceptre-<report>-<branchCode|all-branches>-<from>-<to>.csv` (or `-asof-<date>`
for an ageing report). Money is emitted as **integer minor units** and the header names the
unit (`value_minor`, `outstanding_minor`) — an export that divides by 100 has introduced a
float into a report.

Each export function lives beside the read it exports:
`credit.service.ts:exportAging`, `payables.service.ts:exportAging`,
`loyalty.service.ts:exportLiability`, `audit.service.ts:exportEntries`,
`inventory.report.ts:exportStockReport`. They call the same service function the JSON route
calls, so the CSV and the screen cannot diverge — no second query.

**Manager parity.** The credit, payables and loyalty exports are built from the *rows the
caller is allowed to see*, not from `byBranch`. A manager's file has their branch's
customers. This is the specific Phase 9 defect P14-D17 refuses (research fact 27).

`audit.service.exportEntries` selects `createdAt, actorStaffId, action, entity, entityId,
branchId, terminalId, requestId` and nothing else. A test asserts the CSV body does not
contain a seeded customer's email or phone.

### 4. Two lists learn what a period is

`transfers.validation.ts` and `counts.validation.ts` gain optional `from`/`to` (Accra
days), applied to `dispatched_at`/`created_at` respectively, plus an index check: if
`EXPLAIN (ANALYZE, BUFFERS)` on the demo month shows a sequential scan over more than
5 000 rows, add the composite index in this plan and record the measurement in the phase's
evidence. No index is added speculatively (Phase 11's rule).

### 5. The analytics sales row gains an id

`analytics.repository.selectSalesPage`'s row and `AnalyticsSalesRow` gain `saleId`. The
console's analytics table links each receipt to the oversight detail, and a receipt number
with no id is a row a manager can read but not act on. One column, no new query, no change
to any figure — and it keeps D2 true without a second table.

### 6. Tests — `inventory.report.test.ts`, plus additions to three suites

- the report's `totals.valueMinor` equals `SELECT SUM(quantity_on_hand * avg_cost_minor)`
  for the same filter, to the pesewa;
- an admin's `totals` equal the sum of `byBranch`, and a manager's equal the row for their
  own branch (the parity test that would have caught Phase 9's collapse);
- a manager's CSV has one line per product and a `TOTAL` line, and is **not** a single
  `TOTAL` row; the same test for credit ageing, payables ageing and loyalty;
- the movement section's `byType` sums to the ledger's `SUM(quantity_delta)` for the period
  (`inflow − outflow`); filtering `type=SALE` returns the sales only;
- `from`/`to` on transfers and counts exclude a row one day outside the window;
- CSV: a product named `=cmd|' /C calc'!A0` is emitted with a leading apostrophe; the body
  starts with a BOM and uses CRLF (`csv.test.ts`'s rules, re-proven at the route);
- the audit CSV contains no `before`/`after` column and no seeded email address;
- a cashier gets 403 on all five exports and on the report;
- a manager requesting another branch's export gets 403;
- the 50 001st row is refused rather than streamed (assert the error, not the length).

## Verification

```bash
bun run --filter api test     # ~780 → ~815
bun run check-types
```

Then print one of each CSV and add the columns by hand against `psql`. The stock report's
total must equal the dashboard's stock value for the same branch on the same day; if it
does not, one of them is reading a different basis and the plan is not done.

## Commits

1. `feat(api): the stock report — projection value, period movement, transfers and counts`
2. `fix(api): the movement filter accepts every movement the ledger stores`
3. `feat(api): stock, credit, payables and loyalty exports that keep a manager's rows`
4. `feat(api): the audit export carries the trail, not the payload`
5. `feat(api): transfers and counts can be asked for a period`
6. `test(api): export parity, period boundaries, formula escaping and the audit's silence`

## Done when

- A manager can hand an accountant a stock valuation and a payables ageing that agree with
  the ledgers.
- No export is a single `TOTAL` row.
- The audit export cannot leak a customer's phone number.
