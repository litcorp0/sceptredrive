# Phase 10 — Research notes (2026-10-25)

Official sources consulted before planning, and what this repository actually contains. Every
claim below is either cited or verified here with a path.

---

## PowerSync — reactive local queries

Sources: <https://docs.powersync.com/client-sdks/frameworks/react.md>,
<https://docs.powersync.com/client-sdks/watch-queries.md> (fetched 2026-10-25)

- `useQuery(sql, parameters, options)` **is** a watched query: it re-runs whenever a dependent
  table changes, from a local write *or* from sync. Local-only tables are watched the same way
  as synced ones, which is what makes an offline dashboard possible.
- Options that matter here, all verified in the **installed** typings rather than only the
  site — `node_modules/@powersync/react/lib/hooks/watched/watch-types.d.ts` and
  `node_modules/@powersync/common/lib/client/CommonPowerSyncDatabase.d.ts:55-64`:
  - `throttleMs` — "the minimum interval between queries". Available on this version.
  - `reportFetching` — suppresses `isFetching` churn so a component does not re-render on
    every table change when the result is identical.
  - `rowComparator` — incremental mode; keeps array/row object references between emissions.
    Not applicable to the home screen's scalar aggregates (each returns one row) but correct
    for the top-five and out-of-stock lists.
  - `fetchReason` — `'initial' | 'refresh' | 'tables-changed' | 'settings-changed'`; the last
    one tells you the rows on screen still belong to the previous query.
- Installed versions: `@powersync/react@2.1.0`, `@powersync/web@2.5.0`, `@journeyapps/wa-sqlite@2.0.8`
  (`desktop/package.json`). The package export list at
  `node_modules/@powersync/react/lib/index.d.ts` confirms `useQuery`, `useSuspenseQuery`,
  `useWatchedQuerySubscription`, `useStatus`.
- **Nothing in this repository uses `db.watch()` or `useWatchedQuerySubscription` yet.**
  `useQuery` is the established pattern in eleven files
  (`components/pos/app-header.tsx:37`, `lib/pos-runtime.ts:101`, `lib/customers/context.ts:74`,
  `lib/sync/outbox-summary.ts:23`, …). Phase 10 follows it and adds no second idiom.

## PowerSync — performance rules that shaped the home screen

Source: <https://docs.powersync.com/client-sdks/advanced/performance-optimization.md>

- *"For auto-updating watched queries on frequently-changed tables, queries might run very
  often. Watched queries should typically be cheap to run… For more expensive queries that
  still need to be watched, consider increasing their throttle to run them less often."*
  → P10-D12: 250 ms throttle, day-bounded SQL, no unbounded scans.
- *"When filtering on other columns of large tables, make sure these columns are covered by
  indexes declared in your app's schema."* → the composite `sale(terminal_id, occurred_at)`
  index is declared in `schema.ts`, not created by a migration script.
- *"For cheap statements that run frequently… enable a cache of prepared statements"* —
  `preparedStatementsCache: 64`. Confirmed present in the web adapter:
  `node_modules/@powersync/web/lib/db/adapters/options.d.ts` (`ResolvedWebSQLOpenOptions`)
  and consumed in `RawSqliteConnection.d.ts`.
- PowerSync tables are JSON views; column access parses JSON. Aggregates over `sale_line` are
  therefore the most expensive thing the home screen does, and they are bounded to one day.

## Recharts 3 and the shadcn chart wrapper

Sources: <https://ui.shadcn.com/docs/components/chart> (fetched 2026-10-25), and the Phase 9
research file `phases/09-analytics-dashboard/01-RESEARCH.md` (recharts#7905, recharts#6716).

- The registry `chart` component targets **Recharts v3**; the repo pins `recharts ^3.10.1`.
- V3 rules that apply to new charts: reference tokens as `var(--chart-1)` (**not**
  `hsl(var(--chart-1))`); keep a height or `min-h-*` on `ChartContainer` so
  `ResponsiveContainer` can measure on the first render; do not put `layout` on `<Bar>` when
  the parent chart already defines it; use `ChartTooltip.defaultIndex` only for initial state.
- `accessibilityLayer` is **true by default in 3.x** and adds ARIA roles, one tab stop per
  chart, and arrow-key navigation. It does not add descriptions, legends, or tables — those
  are ours (P10-D14). Never set it false.
- Recharts uses **arrow keys, not Tab**, between points; every extra tab stop inside a chart
  is a WCAG 2.4.3 cost.
- Known defect recharts#7905: keyboard navigation is inert while the pointer rests over the
  chart. Browser evidence must park the pointer off-chart before asserting arrow keys.
- **The chart is already in the renderer bundle.** `.vite/renderer/main_window/assets/index-*.js`
  builds to 1,218,967 bytes (349,210 gzip) and contains `AreaChart`, `CartesianGrid`,
  `recharts-surface`, and `isAnimationActive` — pulled in by `routes/_pos/dev-charts.tsx`,
  which `main.tsx:69` imports statically. The home chart therefore adds ~nothing, and retiring
  `dev-charts` should make the bundle **smaller**. D11's 250 KB budget is measured both ways
  and recorded either way.

## shadcn registry — what exists, and the CLI hazard

Source: <https://ui.shadcn.com/docs/components/base/empty>

- `empty` (`Empty/EmptyHeader/EmptyMedia/EmptyTitle/EmptyDescription/EmptyContent`) and
  `spinner` exist in the registry and are missing from the desktop; the admin already has
  `empty`. The POS's empty states today are hand-written dashed boxes
  (`components/pos/product-grid.tsx:133-140`).
- The Phase 7 finding stands and is a hard rule for Plan 03: shadcn CLI 4.x **plans to
  overwrite existing registry dependencies even without `--overwrite`, and appends 16 default
  oklch/hsl variables to the app stylesheet**, which would silently override `@sceptre/brand`.
  Move existing primitives aside, generate, restore byte-identical, and diff the CSS. Never run
  `shadcn add` over the live token file without checking the diff.

## WCAG 2.2 — the criteria this phase is measured against

| SC | Requirement | Where it lands |
|---|---|---|
| 1.4.11 Non-text Contrast | 3:1 for UI components and graphics | chart bars on `bg-card` (P9-D3), focus ring, input boundaries |
| 2.4.3 Focus Order | order follows meaning | tab order matches visual order on every screen (D8) |
| 2.4.7 Focus Visible | visible indicator | the unlayered `:focus-visible` rule in `desktop/src/renderer/index.css:31-47` |
| 2.5.8 Target Size (Minimum) | 24×24 CSS px, AA | project standard is 44×44 (D8) — exceeds it |
| 1.4.3 Contrast (Minimum) | 4.5:1 text | `--topbar-foreground` on `--topbar`, and chip labels stay `text-foreground` |

The POS's existing contrast corrections (chip colour carried by the dot/tint, never the label;
`--line-strong` for input boundaries) are Phase 7 decisions and are not revisited here.

## What this repository contains that the plan depends on

| Fact | Path |
|---|---|
| Sales, lines, tenders, shifts, outbox are **local-only** tables | `desktop/src/renderer/lib/powersync/schema.ts:183-489` |
| `sale` indexes today: `sale_shift`, `sale_occurred` (no terminal+date) | `schema.ts:242` |
| The database opens with an explicit VFS and no prepared-statement cache | `desktop/src/renderer/lib/powersync/database.ts:46-70` |
| `useQuery` is used in 11 files; no `db.watch()` anywhere | `grep -rn "useQuery" desktop/src/renderer` |
| Day window maths is duplicated inline on the sales screen | `routes/_pos/sales.tsx:31-38` |
| Average basket is computed inline in the API | `api/src/modules/analytics/analytics.service.ts:256-261` |
| Expected cash is one pure function, reused by close and the shift screen | `lib/shift/shift-service.ts:54-62`, `:294-320` |
| Shift cash totals are one SQL aggregate | `lib/shift/shift-repository.ts:235-265` |
| Outbox status vocabulary: `pending`, `in_flight`, `conflict`, `dead_letter` | `lib/sync/outbox-summary.ts:24-27` |
| Conflicts are `status = 'OPEN'` with `severity`; server is the only source | `lib/sync/conflicts.ts:14-53` |
| Login lands on `#shift`; a shift opens onto `#pos` | `routes/login.tsx:27`, `routes/shift.tsx:193` |
| `#pos` means "selling" at nine call sites | `components/pos/app-header.tsx:75`, `routes/_pos/tender.tsx:176,187,338`, … |
| The guard ladder is five gates in one component | `routes/_pos/app.tsx:50-148` |
| The renderer never applies `.dark` | `grep` over `desktop/src` — only `components/ui/chart.tsx:9` |
| Recharts is already bundled via `dev-charts` | `main.tsx:7,69` |
| Desktop tests are node-environment vitest over `*.test.ts` only | `desktop/vitest.config.mts` |
| The module gate is admin-hardcoded | `scripts/check-modules.mjs` (390 lines) |
| The gate can be proven to fail, 20/20 mutations | `phases/08-admin-modules-shell/evidence/verify-module-gate.mjs` |
| The desktop is already braced for `@/modules/*` imports | `desktop/biome.json` `noRestrictedImports` |
| Playwright + `_electron` harness, packaged binary path | `desktop/test/e2e/security-smoke.mjs:1-60` |
| Every screen is a route file, not a module page (3,860 lines) | `routes/login.tsx`, `routes/shift.tsx`, `routes/_pos/*` |

## Negative findings — things the context assumed that are not true

1. **"Low-stock items" cannot be computed on the terminal.** `stock_threshold` is not synced
   (`powersync/sync-config.yaml`). → P10-D2.
2. **"Both themes" cannot be verified on the terminal.** There is no dark mode. → P10-D8.
3. **The home screen cannot show branch takings.** Sales are not synced. → P10-D1.
4. **A tender mix on the till would need P9-D2's derivation re-implemented.** → P10-D4.
