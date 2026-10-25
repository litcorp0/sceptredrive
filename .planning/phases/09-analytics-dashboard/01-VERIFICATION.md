# Phase 9 — Verification

**Phase:** Analytics, Dashboard & Reporting Read Models
**Verified:** 2026-10-25
**Plans:** 8/8 complete
**Branch:** `phase-09-analytics`
**Transcript:** `evidence/suites.txt` (one full gate matrix)
**Contract:** `00-CONTEXT.md`, refined by the four decisions in `00-DECISIONS.md`

Goal-backward: every paragraph below names the command or recorded step that would fail if
the claim were false. There is no "tasks done" reasoning here.

---

## Roadmap success criteria

### 1. Every dashboard and analytics figure is a server aggregate that reconciles to the ledgers; nothing is computed from a paged list endpoint

- Only `api/src/modules/analytics/` serves these numbers; the module has no list endpoint and
  the client sends no aggregate request. `grep` over `admin/src/modules/analytics` finds no
  summing of rows (the gateway invariant in `suites.txt` reports **0** uses of
  `parseFloat`/`toFixed`/`/ 100` outside the display formatter).
- `analytics.test.ts` proves the arithmetic against the tables it summarises:
  - overview `takeMinor` = `Σ sale.total_minor`, series sums to it, tender mix sums to it;
  - `revenueBaseMinor` = `Σ sale_line.base_minor`; `grossProfitMinor` =
    `revenueBase − Σ(unit_cost_minor × quantity)`;
  - tax header = VAT + NHIL + GETFund; category split sums to base;
  - credit `outstandingMinor` = the ledger sum (`reconcileDriftMinor` asserted 0);
  - payables outstanding = `total − paid`, and its ageing buckets equal
    `/api/payables/aging` totals for the same scope;
  - inventory value = `Σ quantity_on_hand × avg_cost_minor`, recomputed in the test.
- Every request runs in `repeatable read, read only` with `statement_timeout = 3s`
  (`analytics.service.ts`), so a KPI and the series under it cannot observe different
  snapshots.
- Drift between the charged header and the server recomputation is returned, not hidden:
  the drift test stores a `TOTAL_MISMATCH` and asserts `driftMinor = { revenue: -1, tax: 2 }`.

**Command:** `bun run --filter api test -- analytics` → **26 passed**.

### 2. A manager sees only their own branch and cannot obtain another branch's numbers by changing a parameter; an admin sees the organisation with branch comparison

- Scope is `resolveBranchFilter` on every endpoint, including all seven exports. A manager
  passing another branch receives **403 `FORBIDDEN`**, not an empty payload (tested for the
  overview, the product export, and the credit export).
- A manager omitting `branchId` is narrowed to their branch; the admin's null scope returns
  `branchRanking` with every branch (asserted: two branches, ordered by take).
- The manager walkthrough leg appends a foreign `branchId` to `/analytics` and asserts the
  rendered figures are byte-identical; the client drops the parameter for managers before
  the request, so their page never 403s.

**Command:** `bun run --filter admin test:walkthrough` → **138/138**, including
"a foreign branchId does not change a manager's analytics view".

### 3. Period, branch, and granularity live in the URL, so any view can be linked and reloaded

- `analyticsSearchSchema` (Zod 4, used directly as `validateSearch`) holds `tab`, `from`,
  `to`, `granularity`, `branchId`, `sort`, `direction`, `offset`; `stripSearchParams` keeps
  defaults out of the href.
- Presets write **absolute** dates (`applyPreset`), so a copied link shows the same window
  tomorrow.
- The header branch switcher writes the search param on `/` and `/analytics` (P9-D4).
- The walkthrough deep-links `/analytics?tab=tax&granularity=month` and asserts the tab and
  its charts render; every tab is visited by URL.

**Step:** walkthrough section "analytics charts and export" (7 URLs) + "every section".

### 4. Charts state their own meaning without a hover: labelled axes, a legend, a summary sentence, and a data-table alternative

- `ChartCard` renders a `<figure aria-labelledby>` with a summary sentence, the axes' names,
  and a `<details>` disclosure containing a `<caption>`ed table of the same numbers.
- The walkthrough asserts, for **every** chart on **every** tab: a non-empty caption, a
  `figcaption`, axis `<text>` elements, a `<details>`, a table, and a table caption.
- Keyboard: `Tab` reaches the chart, `ArrowRight` moves the active point and opens the
  tooltip — proven with the pointer parked off-chart (recharts#7905 would otherwise fake a
  failure). Series colour is `rgb(242, 106, 27)` and measures ≥ 3:1 against its panel.

**Command:** walkthrough checks "every chart has a caption, an aria-label, axes, and a data
table" and "chart is readable by keyboard arrow keys".

### 5. Deltas, tender mix, top products, and the tax split are derived from integer minor units; no floating-point arithmetic touches money

- `packages/shared/src/percent.ts` computes deltas and ratios with integer division
  (half away from zero); a zero denominator returns `null`, never `Infinity`. **11 unit
  tests**, including the OWASP and rounding cases.
- Responses carry `…Minor` integers and `…Bp` integers; the client formats, never computes.
- Cash is **derived** (`take − electronic − credit`) because a CASH tender row contains the
  change handed over; the test asserts the three components sum to the take exactly.
- The tax split comes from the header columns; the category split from the lines; the
  difference is surfaced as `driftMinor`.

**Command:** `bun run --filter @sceptre/shared test` → **127 passed** (was 96).

### 6. A demo seed produces a realistic month of sales so the dashboard is reviewable locally

- `bun run seed:demo-sales` created **168 shifts and 2,422 sales** across three terminals in
  two retail branches, through `applySale` — so sale, line, tender, stock, credit, loyalty,
  and shift ledgers were all written by the owning path. Second run reports nothing to do.
- The demo month is what the walkthrough and the performance evidence run against.

**Command:** `bun run seed:demo-sales` (transcript in the commit message), planner tests
`bun run --filter api test -- demo-sales` → **8 passed**.

---

## Requirements

| ID | Requirement | Evidence |
|---|---|---|
| ADM-02 | Executive dashboard: sales, transactions, basket, tax, low stock, credit, payables, loyalty, sync health, recent activity — from reconciled aggregates | `/` renders the Till Line, four KPI tiles, five charts, attention strip, recent activity; all fields from `/api/analytics/overview` (plus credit/inventory state tiles). Walkthrough `/` = "Today at" green. |
| RPT-01 | Sales report by date/branch/terminal/cashier with totals and tax split | `GET /api/analytics/sales`; tests assert totals = overview, series and hour-of-day sum to take, pagination stable, unknown sort → 400. |
| RPT-02 | Tax report (VAT/NHIL/GETFund) by period and branch | `GET /api/analytics/tax`; tests assert component sum, category sum = base, rates from `@sceptre/shared`, drift field. |
| RPT-03 | Product performance: quantity, revenue, cost, margin | `GET /api/analytics/products`; tests assert revenue = overview, profit = revenue − cost, margin in basis points, pagination. |
| ANL-01 | Branch-scoped for managers, organisation-wide with comparison for admins, enforced server-side | 403 tests + manager walkthrough leg (see criterion 2). |
| ANL-02 | Read models reconcile to the ledgers, integer minor units, proven by tests | 26 analytics tests (see criterion 1) + shared percent/csv tests. |
| ANL-03 | Period, branch, granularity URL-held; every view exports CSV with formula-injection escaping | URL contract + 7 exports; CSV tests assert BOM, CRLF, `TOTAL` row, OWASP escaping, and branch scope on export. |

---

## Gates (from `evidence/suites.txt`)

| Gate | Result |
|---|---|
| `bun install` | exit 0 |
| `bun run lint` | exit 0 (24 pre-existing warnings) |
| `bun run check-types` | exit 0, all 6 workspaces |
| `bun run brand:check` | exit 0 |
| `bun run tokens:check` | exit 0 — 7 chart tokens, 14 chart/surface contrast pairs |
| `bun run modules:check:strict` | 15/15 modules migrated |
| `bun run test` | shared **127**, desktop **339**, API **394** (was 360), 0 failed |
| `bun run --filter admin build` | exit 0 |
| `bun run --filter desktop package` | exit 0 |
| `bun run --filter admin test:walkthrough` | **138/138** |

**Performance** (`evidence/verify-analytics-perf.mjs`, 2,424 sales / 6,204 lines / 3
branches): every endpoint p95 ≤ **56 ms** against the 300 ms budget; the two hot plans use
the `sale`/`sale_line` indexes and complete in ~3 ms of execution. Transcript printed by the
script; this is evidence, not a CI gate.

---

## Deviations, all deliberate

1. **Every view exports, so four more export endpoints exist.** The plans specified exports
   for sales, products, and tax; ANL-03 says every view, and the inventory/credit/loyalty/
   payables tabs each render an export button. Those four now emit their breakdown table with
   a `TOTAL` row. Money columns stay raw pesewas; loyalty columns are points.
2. **The dashboard makes three requests, not one.** Credit outstanding and stock value are
   state figures that belong to the credit and inventory read models; duplicating them in
   `overview` would create a second source of truth. The three load in parallel against one
   period.
3. **`deadStock` is `{ count }`, not a number.** The plan says "a count only"; the object is
   the shape RPT-04 can grow into, and the admin tab was corrected to match.
4. **The demo seed uses `ACC-SPX-T02/T03`, never T01.** `seed/demo.ts` already owns a closed
   shift on T01; a shared terminal made every run collide.
5. **Evidence capture lives inside the walkthrough.** A separate capture script would have
   duplicated the TOTP sign-in. The walkthrough now runs the 4-width × 2-theme × 2-motion
   matrix, the contrast measurement, and the keyboard proof with the session it already has,
   and leaves the cookie for the perf script.
6. **The perf script calls each endpoint six times, not eleven.** Eleven would breach the
   endpoint's own 120/min limit (and 20/min for exports). Measuring must not require
   disabling a security control.
7. **`role="img"` became a named `<figure>`.** `role="img"` hides descendants from assistive
   technology, which would have muted the Recharts accessibility layer this phase enables.
8. **Low-stock semantics were unified** with `inventory.service.toStockRow` (threshold set
   and `qty <= threshold`), so the overview strip and the inventory tab cannot disagree.

## Defect found and fixed during verification

`stock_movement` gained the `SALE` type in Phase 6, but the console's `StockMovementType`
and `MOVEMENT_META` were never widened. Any stock detail page whose history contained a sale
threw `Cannot read properties of undefined (reading 'tone')` — invisible in Phase 8 because
the demo had no sale movement on the product it opened. The demo month made it certain.
Fixed in `e5f3042` with a comment, and the walkthrough now opens the same detail page.

## Environment note

The dev database was rebuilt (`docker compose … drop/create`, migrate, `db:seed --demo`,
`sync:init`) because an aborted seed run had left partial demo rows and an open shift. It is
a local, generated database; nothing was lost that the seeds do not recreate. The PowerSync
service was restarted and its publication recreated.

## Carry-forwards

- **Refunds** are reserved at `refundsMinor: 0` / `refundCount: 0` and are not rendered; they
  populate in Phase 13.
- **Electronic tender methods** (`MOMO`, `CARD`, `BANK`) arrive in Phase 13; the tender mix
  already groups whatever non-CASH methods exist, so no read-model rewrite is needed.
- **`stock_movement` has no business date.** The inventory flow is bucketed on `created_at`
  (the posting time). If a later phase adds an occurrence timestamp, the read model should
  switch to it.
- **The full stock report (RPT-04) and ageing screens (RPT-05)** stay in Phase 14; this phase
  provides totals, trends, and the dead-stock count.
- **The analytics rate limiter is in-memory per instance**, like the rest of the API. A
  multi-instance deployment needs a shared store (Phase 15).
- **The read-model boundary is a documented exception** (P9-D10): analytics imports sibling
  schemas to aggregate, never sibling repositories, and delegates every existing domain rule
  (ageing buckets, loyalty valuation, low-stock semantics) to the owning service.
