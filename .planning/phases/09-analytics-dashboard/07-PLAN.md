---
phase: 09-analytics-dashboard
plan: 07
title: Dashboard rebuild and dev-charts retirement
lane: admin
depends_on: [06]
requirements: [ADM-02, ANL-01]
---

# Plan 07 — The executive dashboard

## Goal

The landing page stops being three counts and a list. It opens with the Till Line — what the
business took and how it arrived — then four KPI tiles with deltas, the trend and mix that
explain them, the branch comparison an owner needs, a needs-attention strip, and recent
activity. Every figure comes from `GET /api/analytics/overview`.

## Read first

- `admin/src/modules/dashboard/index.ts` — the barrel says everything but itself is
  temporary.
- `admin/src/modules/dashboard/pages/dashboard-page.tsx:14-66` — what is replaced.
- `admin/src/modules/dashboard/components/recent-activity.tsx` — kept, restyled only.
- `admin/src/modules/analytics/` from Plan 06 — `KpiTile`, `ChartCard`, `ChartDataTable`,
  `PanelState`, `ExportButton`, `DeltaBadge` are imported through its barrel.
- `00-CONTEXT.md` D8; `00-DECISIONS.md` P9-D1, P9-D2, P9-D4.

## Tasks

### 1. Route gains the analytics search contract

`admin/src/routes/_authenticated/index.tsx`:

```tsx
import { createFileRoute, stripSearchParams } from "@tanstack/react-router"
import { DashboardPage, dashboardSearchDefaults, dashboardSearchSchema } from "#/modules/dashboard"

export const Route = createFileRoute("/_authenticated/")({
  validateSearch: dashboardSearchSchema,
  search: { middlewares: [stripSearchParams(dashboardSearchDefaults)] },
  component: DashboardPage,
})
```

`dashboardSearchSchema` is re-exported from the analytics search schema (period, granularity,
branch) minus `tab`/`sort`/`direction`, so the two pages cannot disagree about what a period
is. The dashboard barrel gains that one export; it still re-exports only `DashboardPage`
plus the schema pair.

### 2. Page composition (`pages/dashboard-page.tsx`)

```
PageHeader: "Today at <branch|all branches>"  +  period control (30 days default)
TillLine      — take, tender split, tax, sales count, avg basket, change given
KpiRow        — revenue (ex-tax), gross margin, credit outstanding, stock value
TrendCard     — revenue & tax, bar/area by granularity
TenderMixCard — stacked bar: cash, credit, and any other method
TopProductsCard / CategorySplitCard  (two-column at lg, stacked below)
BranchRankingCard — admin only
NeedsAttention    — low stock, over-limit credit, expiring points, open shifts,
                    open sync conflicts
RecentActivity    — 6 audit rows (unchanged component)
```

Rules:

- The heading must **not** contain "Welcome back"; the walkthrough is updated in Plan 08 and
  should match on "Today at" instead.
- `TillLine` is the one dominant number: `font-display`, `text-4xl`, `tabular-nums`, with
  the tender split as labelled sub-figures beneath it. Cash must equal
  `take − electronic − credit` as delivered by the server; the client never derives it.
- When `attention` counts are all zero, the strip renders one quiet line ("Nothing needs
  attention in this period") rather than an empty box.
- Attention items link only to screens that exist today: low stock → `/inventory/stock`,
  over-limit credit → `/customers/aging`, expiring points → `/loyalty`, open shifts →
  `/terminals`, open conflicts → `/audit`. Do not invent query params on other modules'
  routes in this plan.
- `BranchRankingCard` is rendered only when `overview.branchRanking.length > 0`; a manager's
  payload is empty by contract, and the card must not show an empty axis.
- Charts sit on `bg-card`, use `min-w-0`, and obey D10 (labelled axes, legend, summary
  sentence, `<details>` data table).

### 3. Components

`modules/dashboard/components/`:

- `till-line.tsx` — presentational; takes the `totals` object.
- `kpi-row.tsx` — composes four `KpiTile`s from the analytics barrel, each with the matching
  `series`-derived sparkline (server-provided series only; if a KPI has no series, omit the
  sparkline rather than deriving one).
- `trend-card.tsx`, `tender-mix-card.tsx`, `top-products-card.tsx`,
  `category-split-card.tsx`, `branch-ranking-card.tsx` — each wraps `ChartCard`.
- `needs-attention.tsx` — a definition list of counts with `StatusBadge` tones
  (`warn`/`danger`/`info`), text in `text-foreground` per the Phase 7 contrast fix.
- `period-control.tsx` — compact preset + granularity control writing the URL (reuse the
  analytics filter bar's `PERIOD_PRESETS`; do not fork the preset maths).

`stat-card.tsx` is deleted once nothing imports it (its only consumer was the old page). A
`grep` for `StatCard` must return nothing.

### 4. Delete the chart gallery

- Delete `admin/src/routes/dev-charts.tsx`.
- `NEEDS_LANE_CHANGE` → controller removes `dev-charts.tsx` from `ROUTE_EXEMPTIONS` in
  `scripts/check-modules.mjs`.
- Run `bun run --filter admin generate-routes` and commit the regenerated
  `routeTree.gen.ts`.
- `grep -r "dev-charts\|dev/charts" admin/src admin/test scripts` must return nothing.

### 5. Queries

`modules/dashboard/api/` is not created: the dashboard uses the analytics module's client
through its barrel (`analyticsOverviewOptions`). If a barrel export for a query option feels
wrong, the alternative is a thin `api/overview.ts` that re-uses `analyticsKeys` — either is
acceptable, but there must be **one** query key for the overview, not two.

Invalidation: nothing mutates analytics, so no invalidation is added. `staleTime: 60_000`
and `keepPreviousData` apply.

## Verification

```bash
bun run --filter admin check-types
bun run --filter admin lint
bun run modules:check:strict
bun run --filter admin build
grep -rn "Welcome back\|dev-charts\|StatCard" admin/src || true
```

Manual pass: sign in as admin → `/` shows the Till Line, four KPI tiles with deltas, the
trend, tender mix, top products, category split, branch ranking, attention strip, recent
activity; change the period → URL updates and all panels move together; sign in as manager →
no branch ranking, branch pinned, no 403 in the network panel.

## Commits

1. `feat(admin): dashboard search contract and period control`
2. `feat(admin): till line, KPI row, and trend cards`
3. `feat(admin): mix, product, category, and branch cards`
4. `feat(admin): needs-attention strip on the dashboard`
5. `chore(admin): retire the dev chart gallery` (+ controller `chore(scripts): drop the dev-charts route exemption`)

## Done when

- `/` answers "how is the business doing and how did the money arrive" without a hover.
- Every figure is a field from `/api/analytics/overview`; no client sum produces a total.
- Admin sees branch comparison; a manager sees their branch and nothing else.
- `dev-charts.tsx` and `StatCard` are gone, the route tree is regenerated, and the modules
  gate still passes strict.
