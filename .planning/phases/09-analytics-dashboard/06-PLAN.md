---
phase: 09-analytics-dashboard
plan: 06
title: Admin analytics module — /analytics with URL state and seven tabs
lane: admin
depends_on: [04]
requirements: [ANL-01, ANL-03, RPT-01, RPT-02, RPT-03, ADM-02]
---

# Plan 06 — Admin analytics module

## Goal

`/analytics` answers a manager's or an owner's question from the URL down: period, branch,
granularity, tab, and sort live in the search params; every panel has three honest states;
every chart is readable without a hover and has a data-table alternative; every view exports
the same numbers as CSV.

## Read first

- `admin/src/modules/README.md` — the module contract (imports, `ui/` never fetches, keys).
- `admin/src/modules/audit/` — the smallest correct module (keys, `queryOptions`, page).
- `admin/src/components/ui/chart.tsx` — `ChartContainer`, `ChartTooltipContent`,
  `ChartConfig`, `initialDimension`.
- `admin/src/routes/dev-charts.tsx` — the working chart idioms to copy, including
  `usePrefersReducedMotion` and `role="img"` wrappers. (The route itself is deleted in
  Plan 07; copy what you need now.)
- `admin/src/lib/api.ts`, `admin/src/lib/branch-context.tsx`, `admin/src/lib/format.ts`.
- `admin/src/components/common/{empty-state,table-message,pagination,page-header}.tsx`.
- `admin/src/components/layout/sidebar.tsx:34-135,184-213`.
- `packages/brand/src/tokens.css` — chart ramp (now seven), `ok`/`warn`/`danger`/`info`.
- `00-DECISIONS.md` P9-D3, P9-D4.

## Files

```
admin/src/routes/_authenticated/analytics.tsx          # ≤ 25 lines, one barrel import
admin/src/modules/analytics/
  index.ts
  api/keys.ts
  api/analytics.ts
  types/index.ts
  utils/search.ts
  hooks/use-analytics-filters.ts
  components/filter-bar.tsx
  components/tab-nav.tsx
  components/kpi-tile.tsx
  components/delta-badge.tsx
  components/chart-card.tsx
  components/chart-data-table.tsx
  components/panel-state.tsx
  components/export-button.tsx
  components/sortable-head.tsx
  pages/analytics-page.tsx
  pages/tabs/{sales,products,inventory,credit,loyalty,payables,tax}-tab.tsx
```

## Tasks

### 1. Transport addition (allowed: `lib/api.ts` stays transport-only)

Add one sibling export to `admin/src/lib/api.ts`:

```ts
/** Downloads a file response and keeps the server's filename. */
export async function apiDownload(
  path: string,
  query: Record<string, QueryValue>,
): Promise<{ blob: Blob; filename: string }>
```

Same 401 redirect and `ApiError` handling as `apiRequest`; parse
`content-disposition: attachment; filename="…"` with a safe fallback. Do **not** add domain
groups to `lib/api.ts` (the modules gate fails on `domain: {`).

### 2. Search schema (`utils/search.ts`) — Zod 4, no adapter

```ts
export const analyticsSearchSchema = z.object({
  tab: z.enum(['sales', 'products', 'inventory', 'credit', 'loyalty', 'payables', 'tax']).catch('sales'),
  from: z.iso.date().catch(undefined).optional(),
  to: z.iso.date().catch(undefined).optional(),
  granularity: z.enum(['day', 'week', 'month']).catch('day'),
  branchId: z.uuid().catch(undefined).optional(),
  sort: z.string().max(24).catch(undefined).optional(),
  direction: z.enum(['asc', 'desc']).catch(undefined).optional(),
})
export const analyticsSearchDefaults = { tab: 'sales', granularity: 'day' } as const
export function resolvePeriod(search, now = new Date()): { from: string; to: string }
export const PERIOD_PRESETS = ['today', '7d', '30d', 'this-month', 'last-month'] as const
export function applyPreset(preset, now): { from: string; to: string }
```

Rules:

- **Presets write absolute dates.** A shared link must show the same window tomorrow, so
  `?preset=30d` never exists; the preset is a button that navigates to `from`/`to`.
- Missing `from`/`to` resolve to the last 30 days including today (Accra via
  `accraIsoDay`).
- A span over 366 days or `from > to` is corrected client-side to the 30-day default with
  an inline note; the server still rejects it.
- No new unit-test runner is added to `admin` this phase (out of scope); the pure helpers are
  exercised by the walkthrough's deep links and by `check-types`.

### 3. Route file

```tsx
import { createFileRoute, stripSearchParams } from "@tanstack/react-router"
import { AnalyticsPage, analyticsSearchDefaults, analyticsSearchSchema } from "#/modules/analytics"

export const Route = createFileRoute("/_authenticated/analytics")({
  validateSearch: analyticsSearchSchema,
  search: { middlewares: [stripSearchParams(analyticsSearchDefaults)] },
  component: AnalyticsPage,
})
```

Ten lines, one module import, no markup, no data calls — the gate asserts all three.

### 4. API client (`api/keys.ts`, `api/analytics.ts`, `types/index.ts`)

- Keys root `["analytics"]`, then `overview(query)`, `report(name, query)`, `export(name,
  query)` (`keys.export` is used only for invalidation-free downloads; if unused, omit it).
- `queryOptions` factories: `analyticsOverviewOptions(query)`, `analyticsSalesOptions(query)`,
  …, each with `staleTime: 60_000` and `placeholderData: keepPreviousData` so changing the
  period keeps the previous panel visible while the next loads.
- No `enabled` guard is needed: the server narrows a manager automatically, and the admin's
  "all branches" is a valid query.
- Types mirror the Plan 02–04 contract by hand, in `types/index.ts`, as plain interfaces
  (the Phase 8 convention: modules own their types; `lib/api-types.ts` must not return).
- **No money arithmetic in this module.** Totals, deltas, shares, and margin basis points
  arrive from the server; the client formats them. Summing rows to make a total is a defect
  (STATE.md already records two such pre-existing defects; do not add a third).

### 5. Filters and branch precedence

`hooks/use-analytics-filters.ts`:

```ts
const { activeBranchId, canSelectBranch } = useBranch()
const search = routeApi.useSearch()
const navigate = routeApi.useNavigate()

// URL wins when present; managers never send a foreign id.
const branchId = canSelectBranch ? (search.branchId ?? activeBranchId ?? undefined) : undefined
```

- The header `BranchSwitcher` writes both the provider and the search param **when the
  current path is `/` or `/analytics`**; otherwise it only changes the provider. Implement
  by reading `useRouterState` inside `branch-switcher.tsx` and calling
  `navigate({ search: (prev) => ({ ...prev, branchId: id ?? undefined }) })`.
- Choosing "All branches" removes `branchId` (the middleware strips it).
- The filter bar renders: period preset buttons, `from`/`to` date inputs (`<Label>` +
  `htmlFor`, `min`/`max` hints), and a granularity `ToggleGroup` (`Day`/`Week`/`Month`). The
  active branch is shown as read-only text ("All branches" or the branch name) because the
  single branch control is the header `BranchSwitcher`; two controls for one piece of state
  is how they drift. Every control writes the URL and nothing else; there is no local filter
  state.

### 6. Tab navigation

`tab-nav.tsx` uses the existing shadcn `Tabs` with `onValueChange` → navigate, matching
`admin/src/modules/catalog/components/catalog-layout.tsx:36-46`. Each tab is a link
(`<Link to="/analytics" search={(prev) => ({ ...prev, tab })}>`) so middle-click and
keyboard work. `<TabsContent>` is not used; the active tab renders its page component.

### 7. Panels every tab shares

- `panel-state.tsx`: `loading` renders skeleton blocks with the final layout's dimensions
  (not a spinner); `empty` renders `EmptyState` with copy that says how data appears
  ("No sales in this period — sales appear once a terminal uploads a shift"); `error`
  names the panel, shows `ApiError.message`, and renders a **Retry** button calling
  `refetch()`. This is the first retry affordance in the console; use it everywhere.
- `kpi-tile.tsx`: label, value, `DeltaBadge`, optional sparkline (`LineChart`, 44 px, no
  dots, `isAnimationActive={!reducedMotion}`). Value uses `font-display tabular-nums`; money
  goes through `formatGhs`, counts through `formatCount`.
- `delta-badge.tsx`: renders the server's `deltaBp` via `formatBasisPoints`; `null` renders
  `—` with the accessible text "no comparison period". Colour is never the only signal — the
  arrow glyph and the sign carry it; `--ok`/`--danger` only tint.
- `chart-card.tsx`: `<figure>` with `<figcaption>` = the summary sentence the server's
  numbers support ("Revenue rose 12.4% over the previous 30 days, driven by …"), the chart
  inside `role="img" aria-label={summary}`, a legend, and `<details>` containing
  `chart-data-table.tsx`. Chart panels use `bg-card` and `min-w-0` (the Phase 7 overflow
  bug).
- `chart-data-table.tsx`: a real `<table>` with `<caption>`, the same values as the chart,
  money via `formatGhs`, bucket labels via `formatBucket(bucketStart, granularity)`.
- `export-button.tsx`: `Export CSV` → `apiDownload`, object URL, `download` attribute,
  revoke after click, `aria-live` confirmation "Sales CSV downloaded", tooltip "Amounts are
  in pesewas". Disabled while pending; on failure the toast names the report and the reason.
- `sortable-head.tsx`: `<TableHead aria-sort={…}>` wrapping a `<Link>` that flips
  `direction` — no client sorting, no `onClick` on a `<th>`.

### 8. The seven tabs

Each tab page fetches one report and renders: a KPI row, a trend chart, a breakdown chart,
and a drill-down table with server-side sort + `Pagination`.

| Tab | KPI row | Charts | Table |
|---|---|---|---|
| Sales | Take, sales, avg basket, tax | Revenue/tax trend; tender mix (stacked bar); hour-of-day (vertical bar) | Sales rows, sort by date/take |
| Products | Revenue, gross profit, margin, units | Top products (horizontal bar); category split (stacked bar, top 4 + Other) | Products, sort by revenue/units/margin |
| Inventory | Stock value, units, low stock, out of stock | Movement flow by type (stacked bar); value by branch (admin) | Top movers, sort by units |
| Credit | Outstanding, utilisation, over limit, on hold | Charges vs repayments (area); utilisation distribution (bar) | Branch breakdown (admin) |
| Loyalty | Issued, redeemed, expired, outstanding value | Points flow (stacked bar); expiring soon callout | Branch activity (admin) |
| Payables | Outstanding, paid, overdue, on account | Invoiced vs paid (area); overdue buckets (bar) | Top suppliers by owed |
| Tax | VAT, NHIL, GETFund, total | Tax trend (stacked bar) | Category breakdown + drift note when non-zero |

Notes:

- Charts read only server-provided values; `ChartConfig` colours come from
  `var(--chart-1…7)` mapped to series names, `satisfies ChartConfig`.
- Axes are labelled (`XAxis`/`YAxis` with a name and `tickFormatter`); money ticks use
  `formatCount(Math.round(minor / 100))` with the axis label `GHS` — display rounding only,
  exact figures live in the tooltip's `formatter={formatGhs}` and the data table.
- The Tax tab shows the `driftExplanation` sentence only when `driftMinor.tax !== 0`.
- The Credit tab renders no customer row even if the API later offers one; the payload has
  none by contract.

### 9. Navigation and the gate

`admin/src/components/layout/sidebar.tsx`:

- add `"/analytics"` to `NavPath`;
- add `{ to: "/analytics", label: "Analytics", icon: ChartLine, permission: "analytics.read" }`
  to the **Overview** group after Dashboard;
- add `PAGE_LABELS["/analytics"]` and the section label so the breadcrumb reads
  `Dashboard / Analytics` — or `Analytics` alone at the root of the group.

`NEEDS_LANE_CHANGE` → controller edits `scripts/check-modules.mjs`: remove
`analytics: 9` from `DEFERRED_MODULES`, add `'analytics'` to `REQUIRED_MODULES`.
`bun run modules:check:strict` must then pass with the new module present.

## Verification

```bash
bun run --filter admin check-types
bun run --filter admin lint
bun run modules:check:strict
bun run --filter admin build
bun run --filter admin dev   # manual pass, see below
```

Manual pass (recorded for Plan 08): open `/analytics`, switch all seven tabs, change the
period and granularity (URL updates), deep-link `/analytics?tab=tax&from=…&to=…&granularity=month`
in a new tab and confirm identical figures, download one CSV per tab, verify a manager
session shows the locked branch badge, no branch ranking, and no branch breakdown column.

## Commits

1. `feat(admin): analytics search schema and URL-driven filters`
2. `feat(admin): shared analytics panel, KPI, and chart components`
3. `feat(admin): sales, products, and tax tabs`
4. `feat(admin): inventory, credit, loyalty, and payables tabs`
5. `feat(admin): CSV export and the analytics nav entry`
6. `chore(scripts): promote analytics to a required module` (controller)

## Done when

- `/analytics` is reachable from the sidebar for admins and managers, and is a ≤ 25-line
  route importing exactly one barrel.
- Every filter is in the URL; reloading and sharing reproduce the view exactly.
- Every chart has labelled axes, a summary sentence, and a data-table alternative.
- Every panel has loading, empty, and error-with-retry states.
- No client-side money arithmetic exists in the new module.
