# Phase 9 — Research notes (2026-10-24/25)

Official sources consulted before planning. Every claim below is either cited or verified in
this repository with a path and line reference.

## TanStack Router — search params

Source: <https://tanstack.com/router/latest/docs/framework/react/guide/search-params>

- With **Zod 4**, pass the schema directly to `validateSearch`; `@tanstack/zod-adapter` is
  the Zod 3 path. `validateSearch: analyticsSearchSchema` is correct here
  (`admin` is on `zod ^4.3.6`, catalog `4.6.7`).
- `.catch(value)` silently falls back; `.default(value)` makes the param **required** for
  `<Link>` type-checking. Use `.catch` for malformed URLs, `.default` only where the link
  should be forced to state it.
- Search params are JSON-first: first-level numbers and booleans round-trip as types, so no
  `z.coerce` layer is needed on the client (the API still validates everything).
- `search.middlewares: [stripSearchParams(defaults)]` removes default values from generated
  hrefs. This is how "all branches + last 30 days" stays a clean `/analytics` URL.
- Reading in a module page uses `getRouteApi("/_authenticated/analytics").useSearch()`,
  matching the Phase 8 pattern in `admin/src/modules/payables/pages/invoices-page.tsx:41`.

## Recharts 3 — accessibility and sizing

Sources: <https://github.com/recharts/recharts/wiki/Recharts-and-accessibility>,
<https://github.com/recharts/recharts/blob/main/storybook/stories/API/Accessibility.mdx>,
<https://recharts.org/en-US/api/ResponsiveContainer>

- `accessibilityLayer` is **true by default in 3.x** (false in 2.x). It adds ARIA roles,
  one tab stop per chart, and arrow-key navigation between points. Do not set it to false.
- It explicitly does **not** provide descriptions, legends, or data tables — "those are
  yours to add". D10's summary sentence and data-table alternative are therefore mandatory,
  not decorative.
- Recharts uses **arrow keys, not Tab**, for point navigation; every extra tab stop inside a
  chart is a WCAG 2.4.3 cost, so the chart stays one stop.
- Known defect (recharts#7905, Oct 2026): keyboard navigation is inert while the pointer
  rests over the chart. Browser evidence must move the mouse off the chart before asserting
  arrow-key behaviour, or it will flake.
- `ResponsiveContainer` warns and mis-sizes when it has no dimensions on first render
  (recharts#6716). `admin/src/components/ui/chart.tsx:11` already passes
  `initialDimension={{ width: 320, height: 200 }}`, which makes the SSR/first paint
  deterministic; keep it and keep chart panels on `bg-card` for 1.4.11 contrast.
- Recharts 3 removed `activeIndex` and several cloned props; the Phase 7 wrapper is already
  on 3.x, so nothing to migrate.

## TanStack Start — SSR and charts

Source: <https://tanstack.com/start/latest/docs/framework/react/guide/hydration-errors>

- The documented fixes are `ClientOnly`, selective SSR (`ssr: 'data-only' | false`), or
  deterministic first render. Because the chart container has a fixed `initialDimension`
  and charts render only after data arrives (skeleton before), the deterministic-first-render
  route is chosen. No `ClientOnly` wrapper is added unless the evidence script proves a
  mismatch; blind `suppressHydrationWarning` is forbidden.

## PostgreSQL 17 — series and bucketing

Sources: <https://www.postgresql.org/docs/17/functions-datetime.html>,
<https://www.postgresql.org/docs/17/functions-srf.html>

- `date_trunc(field, source timestamptz, time_zone text)` exists in 17: the timezone-aware
  form truncates in the named zone regardless of the session `TimeZone`. Use
  `date_trunc('day', occurred_at, 'UTC')`.
- `generate_series(start, stop, '1 day')` fills gaps; a `LEFT JOIN` from the series to the
  aggregate yields zeros for empty buckets.
- `SUM(integer)` returns `bigint`; node-postgres hands it back as a string. The repo's
  convention — `sql<number>\`coalesce(sum(...), 0)\`.mapWith(Number)` — is mandatory
  (`api/src/modules/inventory/inventory.repository.ts:104-129`).
- Half-open ranges (`>= from AND < to`) keep the index usable and avoid double-counting a
  boundary sale.

## Drizzle 0.45 — read-only snapshot

Verified in `node_modules/drizzle-orm/pg-core/session.d.ts:32-33`:

```ts
isolationLevel?: 'read uncommitted' | 'read committed' | 'repeatable read' | 'serializable'
accessMode?: 'read only' | 'read write'
```

`db.transaction(fn, { isolationLevel: 'repeatable read', accessMode: 'read only' })` is
available and is the mechanism behind P9-D6.

## OWASP — CSV injection

Source: <https://owasp.org/www-community/attacks/CSV_Injection>

- Danger set: `=`, `+`, `-`, `@`, TAB (`0x09`), CR (`0x0D`), **LF (`0x0A`)**, and full-width
  `＝ ＋ － ＠`.
- Mitigation: quote every cell, double internal quotes, prefix a leading `'`.
- Excel may strip those on save/reopen. The Excel-resistant variant prefixes a TAB inside
  the quoted field; it pollutes programmatic consumers, so it is documented and **not**
  applied.
- Also relevant: OWASP A01 (deny by default — the 403-not-empty-chart rule), A03/A05 (CSV as
  an injection surface), A09 (no PII in logs).

## Verified repository facts used by the plans

| Fact | Where |
|---|---|
| `sale` has no status/refund column; tax columns are `vat_minor`, `nhil_minor`, `getfund_minor`, `tax_total_minor` | `api/src/modules/pos/pos.schema.ts:105-158` |
| `sale_line` carries `base_minor`, `taxable_minor`, `net_minor`, `unit_cost_minor` | `pos.schema.ts:160-198` |
| `sale_tender` methods are `CASH`, `CREDIT` only | `pos.schema.ts:200-216` |
| Indexes `sale_branch_occurred_idx`, `sale_terminal_occurred_idx`, `sale_customer_occurred_idx`, `sale_line_product_idx`, `shift_branch_opened_idx` exist | `pos.schema.ts`, `sale_line` indexes |
| `stock_level.quantity_on_hand × avg_cost_minor` is the only valuation; never SQL-aggregated today | `api/src/modules/inventory/inventory.service.ts:499-514` |
| Credit balance is the stored projection `credit_profile.balance_minor` | `credit.schema.ts:46-80` |
| Loyalty liability = `Σ balance_points` valued by `loyalty.pointsPerCedi` | `api/src/modules/loyalty/loyalty.service.ts:479-519` |
| Payables outstanding = `total_minor − amount_paid_minor` on `OPEN`/`PARTIAL` | `api/src/modules/payables/payables.service.ts:117-120` |
| `applySale(context, payload, executor)` is directly callable; `receivedAt` and `clockSkewToleranceMinutes` are context fields | `pos.service.ts:766`, `pos.types.ts:204-210` |
| Clock skew is `|receivedAt − occurredAt|`; a seed can set them equal to avoid false conflicts | `pos.service.ts:1203-1216` |
| `resolveBranchFilter` throws 403 for a manager's foreign branch | `api/src/auth/scope.ts:34-45` |
| Rate limiter exists, in-memory, key overridable per request | `api/src/http/rate-limit.ts` |
| `toCsv`/percent helpers do not exist; `formatBucket` is implemented and unused by the admin | `packages/shared/src/dates.ts:122-131` |
| `analytics` is `DEFERRED_MODULES = { analytics: 9 }` | `scripts/check-modules.mjs:33,55` |
| `NavPath` is a closed union; nav is permission-filtered | `admin/src/components/layout/sidebar.tsx:34-99,204-213` |
| Branch is localStorage only (`sceptre-drive.admin.branchId`) | `admin/src/lib/branch-context.tsx:7,45-64` |
| Dashboard is 66 lines of stat cards; marked temporary for Phase 9 | `admin/src/modules/dashboard/pages/dashboard-page.tsx:14-15` |
| `dev-charts.tsx` is marked for deletion and is a route exemption | `admin/src/routes/dev-charts.tsx:30`, `scripts/check-modules.mjs:96` |
| Walkthrough asserts `["/", "Welcome back"]` and tolerates only the `/api/branches` 403 | `admin/test/walkthrough-sections.mjs:135,191-192` |
| Chart ramp is 5 steps with a 3:1-ish floor; `--line` vs `--line-strong` precedent for AA fixes | `packages/brand/src/tokens.css:65-70,121-125`, `scripts/check-tokens.mjs:81,344` |
| No migration is needed: permissions are code, not rows | `packages/shared/src/permissions.ts` |

## Documentation defects found (fix in Plan 08, not scope)

- `ROADMAP.md:158` says "PowerSync Cloud (Phase 9 setup gate)". That is old numbering: the
  PowerSync hosting decision belongs to Phase 15 (production hardening).
- `AGENTS.md` says `bun test` for the suite; `STATE.md:307-309` established that it must be
  `bun run test`, because Bun's builtin runner ignores workspace scripts. Worth correcting
  in the same documentation pass.
