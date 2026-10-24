---
phase: 09-analytics-dashboard
name: Analytics, Dashboard & Reporting Read Models
depends_on: [03-inventory-transfers, 04-customers-credit, 05-suppliers-payables, 06-pos-offline-core, 07-identity-design-system, 08-admin-modules-shell]
requirements: [ADM-02, RPT-01, RPT-02, RPT-03, ANL-01, ANL-02, ANL-03]
status: context-locked
created: 2026-10-24
---

# Phase 9 — Analytics, Dashboard & Reporting Read Models — Locked Context

**Goal:** The console shows the truth about the business — real, reconciled, branch-correct
numbers with charts that answer a manager's question and an owner's question differently.

## Locked Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Where the numbers come from | A new read-only API module `api/src/modules/analytics/` in the seven-file layout. **Never** client-side aggregation over a paged list endpoint | A list endpoint returns 20 rows of a domain object, not a rollup. Aggregating in the browser leaks the whole dataset, breaks branch scoping, and produces a different answer on every page size |
| D2 | Endpoint surface | `GET /api/analytics/overview` and `GET /api/analytics/{sales,products,inventory,credit,loyalty,payables,tax}`. `overview` powers the dashboard; the rest power the analytics tabs. Each returns one bounded payload with `period`, `comparison`, `totals`, `series`, and its own breakdowns | One endpoint per screen keeps payloads small and cache keys obvious. A single mega-endpoint would refetch every tab on every filter change |
| D3 | Authorisation | New permission `analytics.read`, granted to ADMIN and MANAGER. Every request runs `requireSession` → `requirePermission('analytics.read')` → branch scope. A manager passing another branch's `branchId` gets **403**, not an empty result. A manager omitting `branchId` is narrowed to their branch | OWASP A01: deny by default, enforce on the server, never rely on hidden UI. An empty chart for a forbidden branch looks like "no sales", which is a lie |
| D4 | Branch scope mechanics | Reuse `branchScope`, `assertBranchAccess`, and `resolveBranchFilter` from `api/src/auth/scope.ts`. No new auth machinery | Already proven across transfers, terminals, and branches |
| D5 | Numeric contract | Money is integer minor units everywhere. Percentages and deltas are **integer basis points** (`1240` = +12.40%). Ratios that are not money (margin, conversion) are also basis points. No `number` in a response ever represents cedis | AGENTS.md rule 4. A float in a trend line is a float in the money path |
| D6 | Period contract | `from` and `to` are ISO dates, inclusive, `to ≥ from`, maximum span 366 days. `granularity ∈ day \| week \| month`. `comparison` is the immediately preceding period of equal length, computed server-side | Bounded queries prevent an accidental full-table scan; computing the comparison on the server keeps "vs previous period" identical for every client |
| D7 | URL state | Period, branch, granularity, and the active analytics tab live in the route's search params (`validateSearch` with Zod), so a view can be linked, bookmarked, and reloaded | Operator requirement; also makes support conversations possible ("send me the link") |
| D8 | Dashboard content | **Till Line** (total take + how it arrived: cash · MoMo · card · bank · credit · tax), four KPI tiles with sparkline and delta (revenue, gross margin, credit outstanding, stock value), revenue/tax trend, tender mix, top products, category split, branch ranking (admin only), a needs-attention strip (low stock, sync conflicts, open shifts, credit over limit, points expiring), and a compact recent-activity table | Operator requirement: "charts and other needed information, not only the stat card and recent activity". One primary number, everything else subordinate |
| D9 | Analytics page | Own route `/analytics`, segmented tabs Sales · Products · Inventory · Credit · Loyalty · Payables · Tax. Each tab: KPI row, trend vs previous period, a breakdown chart, and a sortable drill-down table. Manager sees their branch; admin sees the organisation with branch comparison | Same phase, same read models — the dashboard is the summary, analytics is the drill-down |
| D10 | Chart rules | Recharts through the Phase 7 `chart` wrapper. Trend → area/line; composition → stacked bar; ranking → horizontal bar. Axis labels are mandatory, values are read from the axis rather than a tooltip alone. Every chart has a summary sentence and a data-table alternative | ui-ux-pro-max `chart` domain: "if a user must hover to understand the basic gist, the visualization has failed" |
| D11 | Empty, loading, error | Each panel has three explicit states. Empty states explain what will appear and how to produce it ("No sales recorded for this period — sales appear here once a terminal uploads"). Loading uses skeleton blocks matching the final layout. Errors name the failed panel and offer retry | A brand-new shop must not see a broken-looking dashboard |
| D12 | CSV export | Server-side, per report. RFC 4180 quoting plus formula-injection escaping: any cell beginning with `=`, `+`, `-`, `@`, tab, or CR is prefixed with `'`. Filenames include the period and branch. Exports are permission-checked exactly like the view | OWASP A03/A05: a CSV is an attack surface once opened in Excel |
| D13 | Performance | Aggregate queries use the existing indexes (`sale_branch_occurred_idx`, `sale_terminal_occurred_idx`, `sale_customer_occurred_idx`, `sale_line_product_idx`, `shift_branch_opened_idx`). No migration and no materialised view in this phase. Top-N lists are capped (`limit ≤ 50`). If a query exceeds 300 ms on the 5-branch demo dataset, it is rewritten, not cached | Indexes already cover the access pattern; premature rollup tables would need invalidation logic the system does not yet have |
| D14 | Demo data | `bun run seed:demo-sales` creates a realistic month across branches (weekday/weekend shape, mixed tenders, some credit, some returns-free, loyalty earn/redeem) through the service layer so every ledger reconciles. Idempotent, guarded to non-production | The dashboard must be reviewable locally without a physical terminal |
| D15 | PII | Aggregates carry customer **ids**, never names or phones. No customer-level row appears on the dashboard or analytics page | Ghana DPA; the console does not need identity to show a trend |

## Invariants

- A number on screen is traceable to one endpoint field. No client arithmetic invents a total.
- Reconciliation is a test, not a hope: `Σ series = Σ sales`, tender mix `= Σ sale_tender`,
  gross profit `= Σ (net − cost)`, credit outstanding `=` ledger balance.
- A manager can never obtain another branch's numbers by changing a URL.
- Charts are readable without a hover, in both themes, at 320 px.

## Open Items

- Returns and refunds arrive in Phase 13; the read models include a `sale` that later gains
  a `refund` sibling. Design the aggregate as `net = sales − refunds` now, with refunds
  returning zero until Phase 13.
- POS oversight (sales/shift/conflict screens) and stock/aging report exports stay in
  Phase 14.
- Catalogue `cost_price_minor` becomes derived and read-only in Phase 11; reports must read
  `stock_level.avg_cost_minor` for current cost and `sale_line.unit_cost_minor` for historical
  cost.
- Electron bundle growth from Recharts is reviewed in Phase 10, not here.
