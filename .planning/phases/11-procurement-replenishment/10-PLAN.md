---
phase: 11-procurement-replenishment
plan: 10
title: Console — replenishment and supplier performance
lane: admin
depends_on: [09]
requirements: [PROC-06, PROC-07, MGR-04]
---

# Plan 10 — The numbers, and the reason for them

## Goal

Two screens that make the read models usable: one that says what to order and *why that number*,
and one that says which suppliers keep their promises and on what evidence. Neither screen does
arithmetic; both render what the API computed, including the inputs.

## Read first

- `00-DECISIONS.md` P11-D3, P11-D10, P11-D11, P11-D12.
- `packages/shared/src/replenishment.ts` — the fields the screen shows are the fields the function
  consumed.
- `admin/src/modules/inventory/components/threshold-dialog.tsx` — the dialog this plan extends.
- `admin/src/modules/inventory/pages/stock-page.tsx` — the existing threshold entry point.
- `admin/src/modules/suppliers/index.ts`, `components/supplier-products-panel.tsx`,
  `components/supplier-product-dialog.tsx` — where a preferred supplier is set today.
- `admin/src/modules/analytics/pages/*` — the console's metric-tile and caveat conventions
  (`PageHeader`, `Card`, `formatGhs`, one-sentence explanations under a figure).

## Tasks

### 1. Module tree `admin/src/modules/replenishment/`

| Path | Responsibility |
|---|---|
| `index.ts` | barrel |
| `api/keys.ts` | `replenishmentKeys`, `performanceKeys` |
| `api/replenishment.ts` | suggestions + performance fetchers and `queryOptions` |
| `types/index.ts` | `ReplenishmentGroup`, `ReplenishmentRow`, `SupplierPerformanceRow`, `SuggestionQuery` |
| `utils/suggestion.ts` | `reasonSentence(row)` — the one-line "why" used in the table and the tooltip; `formatBasis` |
| `ui/suggestion-basis.tsx` | presentational breakdown: sold 90 d · on hand · on order · min/max · lead time · safety |
| `ui/metric-tile.tsx` | a labelled figure with a sentence under it (console convention) |
| `components/suggestions-view.tsx` | grouped table, selection, per-group total |
| `components/replenish-order-dialog.tsx` | review and raise a DRAFT order for a group |
| `components/unassigned-row-actions.tsx` | "Choose supplier" for rows with no preferred link |
| `components/performance-view.tsx` | supplier table + period control |
| `components/performance-row-detail.tsx` | expanded metrics and the exclusion list |
| `pages/replenishment-page.tsx` | composition root |
| `pages/supplier-performance-page.tsx` | composition root |

### 2. Routes

| File | Page |
|---|---|
| `admin/src/routes/_authenticated/procurement/replenishment.tsx` | `ReplenishmentPage` |
| `admin/src/routes/_authenticated/procurement/suppliers.tsx` | `SupplierPerformancePage` |

Six lines each, one barrel import. The tab bar in `ProcurementLayout` already links to both
(Plan 09). The paths stay under `/procurement` even though the pages belong to the
`replenishment` module — the admin contract is explicit that a route path is not a module owner
(`admin/src/modules/README.md:63-67`).

### 3. The replenishment screen

Header: *"What to order"*, with the branch and a sentence: *"Computed from the last 90 days of
sales at this branch, the supplier's lead time, and a 7-day safety buffer."* The numbers in that
sentence are read from the response's settings echo, not hard-coded.

Controls: a `Switch` *"Only items that need ordering"* (default on), a supplier filter, and a
search box. `suggestions-view` renders one collapsible section per supplier group:

```
Accra Auto Parts                       Lead time 7 days        GH₵ 4,820.00
────────────────────────────────────────────────────────────────────────────
SKU        Product                 On hand  On order  Suggested  Unit cost  Value
BRK-1042   Brake pad set, front         10         0        130    GH₵ 32.00  GH₵ 4,160.00
                                                              Why? ▾
```

`Why?` expands `suggestion-basis`, which prints every input the API returned:

```
900 sold in 90 days → 10/day
lead time 7 days + safety 7 days = 14 days cover → 140
max level 40 → target 140
on hand 10 + on order 0 = 10
suggested = 140 − 10 = 130
```

When `leadTimeAssumed` is true the basis line says **"supplier lead time not set — 14 days
assumed"** and the row carries a link to the supplier's Products tab.

Selection: a checkbox per row and a select-all per group; the group footer shows *"N lines ·
GH₵ X"* and a `Raise order` button behind `procurement.create`. `replenish-order-dialog` shows
the lines with editable quantity and unit cost (defaulted to the last cost), an expected date, and
a note; it calls `POST /api/procurement/orders/from-suggestions` and, on success, offers
*"Open draft order"* which navigates to `/procurement/orders/$orderId`. It never submits the order
— that is the order screen's job, and the threshold applies there.

The **Unassigned** group renders last, with its own copy: *"These parts have no preferred
supplier. Choose one to include them in an order."* Each row's action calls a new
`setPreferredSupplier` helper exported from the `suppliers` module barrel, which marks the chosen
supplier-product link as preferred (`is_preferred = true`, which the existing partial unique
enforces) and then invalidates `replenishmentKeys.all`.

Editing min/max happens in two places, with **one** dialog: the existing
`inventory/components/threshold-dialog.tsx` gains a *Maximum* and a *Minimum order quantity*
input. It is already exported from the inventory barrel
(`admin/src/modules/inventory/index.ts:61`), so `stock-page.tsx` keeps its current entry point and
the replenishment row's "Edit levels" action imports the same component from
`#/modules/inventory`. One dialog, two doors — the alternative is two copies that drift.

### 4. The performance screen

Header: *"Which suppliers deliver"*, period control (last 30 / 90 / 365 days), branch via
`useBranch()`. Table columns: supplier, orders, on-time rate, fill rate, promised vs actual lead
time, cost drift, last delivery.

Under the header, one sentence of definition, in words:

> *On time means the first delivery arrived on or before the promised date; early counts as on
> time. Fill rate is what arrived ÷ what was ordered, capped at 100%.*

`performance-row-detail` expands to show:

- the counts behind each rate (`onTimeLines / (onTimeLines + lateLines)`), so the figure is
  checkable by hand;
- `promisedLeadDaysAverageTenths / 10` and `actualLeadDaysAverageTenths / 10` in days;
- cost drift in GHS and basis points, with the product that drifted most;
- **the exclusions**: `noPromiseLines` and `ordersWithoutSendDate`, each with a sentence saying
  why it is excluded. A rate with a hidden denominator is the thing managers stop trusting.

A supplier with no measurable orders shows *"Not enough history yet"* rather than `0%` — the
NetSuite rule from the research: do not render an authoritative-looking figure from no data.

### 5. Empty and error states

- No threshold rows at this branch: *"No stock levels are set for this branch yet. Set a minimum
  and maximum on a product's stock page to start replenishing."* — with a link to
  `/inventory/stock`.
- No suggestions (everything is healthy): *"Nothing needs ordering today."* plus the last
  computed timestamp.
- No supplier history: *"No orders in this period."*
- API error: the standard `TableMessage` with `tone="error"`, never a bare empty table.

### 6. Tests

The admin has no unit-test harness (`admin/package.json` has no `test` script) and this phase does
not add one — adding jsdom here would touch `bun.lock`, a controller file. Verification is:

- `modules:check:strict` green with both new modules;
- `check-types` and `lint`;
- the browser pass in Plan 11's walkthrough, which adds
  `["/procurement/replenishment", "What to order"]` and
  `["/procurement/suppliers", "Which suppliers deliver"]` to
  `admin/test/walkthrough-sections.mjs`'s `SECTIONS`, takes screenshots `plan11-replenishment.png`
  and `plan11-supplier-performance.png`, and asserts zero console errors and zero failed requests
  on both.

### 7. Module gate (controller, same commit as the directory)

`scripts/check-modules.mjs` — add `'replenishment'` to `REQUIRED_MODULES` in the commit that
creates `admin/src/modules/replenishment/`. Same rule as Plan 09: the gate may only name a
directory that exists.

## Verification

```bash
bun run modules:check:strict
bun run --filter admin check-types
bun run --filter admin lint
bun run lint
```

Browser pass:

1. seed a branch with thresholds (Plan 11's fixture script does this), including one product with
   **no** `stock_level` row and one with **no** preferred supplier;
2. the never-stocked product appears with *on hand 0* and a suggestion;
3. the unassigned row is in the Unassigned group and cannot be selected until a supplier is set;
4. select two rows from one group, raise an order, land on the draft order page with the same
   quantities and costs;
5. edit a threshold from the replenishment row and see the suggestion change on refresh;
6. open the performance screen and check one supplier's on-time rate by hand against its orders.

## Commits

1. `feat(admin): replenishment module, routes and the suggestions table`
2. `feat(admin): the basis breakdown and raise-order dialog`
3. `feat(admin): min, max and minimum order quantity in one threshold dialog`
4. `feat(admin): supplier performance screen with stated definitions`
5. `feat(admin): preferred-supplier action from the unassigned group`
6. `chore(scripts): require the replenishment module in the admin gate`

## Done when

- Replenishment groups by supplier, excludes unassigned rows from ordering, and shows the full
  arithmetic behind every suggestion.
- An order raised from suggestions lands as a DRAFT with the costs the server resolved.
- Min/max editing is one component reached from two screens.
- Supplier performance shows a rate only with a denominator, states its definitions, and prints
  what it excluded.
- Both routes are in the module gate, the nav, and the breadcrumb.
