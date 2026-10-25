---
phase: 11-procurement-replenishment
plan: 08
title: Replenishment suggestions and supplier performance
lane: api
depends_on: [07]
requirements: [PROC-06, PROC-07, MGR-04]
---

# Plan 08 — What to order, and who actually delivers

## Goal

The console can answer two questions with arithmetic a manager can audit: *what should I order,
and why that number?* and *which suppliers keep their promises?* Both are read models over facts
already stored — no forecast cache, no new ledger, no table of opinions.

## Read first

- `00-DECISIONS.md` P11-D3, P11-D10, P11-D11, P11-D12.
- `packages/shared/src/replenishment.ts` — every formula used here; this plan does not re-implement
  one.
- `api/src/modules/analytics/analytics.repository.ts:1-40` — the read-model boundary note and the
  sibling-schema import convention (P9-D10).
- `api/src/modules/inventory/inventory.repository.ts:312-390` — `stockConditions`,
  `selectStockPage`.
- `api/src/modules/inventory/inventory.service.ts:592-634` — `setThreshold` and its audit.
- `api/src/modules/pos/pos.schema.ts:145-198` — `sale` and `sale_line`, and the indexes the
  velocity query relies on.

## Tasks

### 1. The `replenishment` module

Seven files, like every module. `replenishment.schema.ts` is `export {}` with a doc comment
(the `analytics/analytics.schema.ts` precedent): the module owns no tables.

`replenishment.repository.ts`:

```ts
/** Every product with a min/max row at this branch, plus the facts a suggestion needs. */
selectReplenishmentRows(branchId, executor): Promise<ReplenishmentFactRow[]>
/** Σ units sold at this branch in the trailing window. */
selectUnitsSold(branchId, days, executor): Promise<Map<string, number>>
/** Σ(ordered − received) over APPROVED / SENT / PARTIALLY_RECEIVED orders. */
selectOnOrderByProduct(branchId, executor): Promise<Map<string, number>>
/** Preferred supplier and lead time per product. */
selectPreferredSuppliers(productIds, executor): Promise<Map<string, SupplierLinkRow>>
/** Receipt history per supplier-product, for cost drift. */
selectReceiptHistory(supplierId, branchId, limit, executor)
/** Order-line facts for the performance window. */
selectPerformanceLines({ branchId, supplierId, from, to }, executor)
```

The base query for `selectReplenishmentRows`:

```
FROM stock_threshold st
JOIN product p            ON p.id = st.product_id AND p.is_active
LEFT JOIN stock_level sl  ON sl.product_id = st.product_id AND sl.branch_id = st.branch_id
LEFT JOIN supplier_product sp ON sp.product_id = p.id AND sp.is_preferred
LEFT JOIN supplier s      ON s.id = sp.supplier_id
WHERE st.branch_id = $1
```

`LEFT JOIN stock_level` is what makes **a part the branch has never stocked** appear (PROC-06):
on hand reads 0. The row exists because the manager set a min/max at this branch, which is the
only honest way to say "we want to stock this here".

`selectOnOrderByProduct`:

```
FROM purchase_order_line pol
JOIN purchase_order po ON po.id = pol.order_id
LEFT JOIN stock_receipt_line srl ON srl.purchase_order_line_id = pol.id
WHERE po.branch_id = $1 AND po.status IN ('APPROVED','SENT','PARTIALLY_RECEIVED')
GROUP BY pol.product_id
HAVING sum(pol.quantity) - coalesce(sum(srl.quantity), 0) > 0
```

`selectUnitsSold`:

```
FROM sale_line sl JOIN sale s ON s.id = sl.sale_id
WHERE s.branch_id = $1 AND s.occurred_at >= now() - make_interval(days => $2)
GROUP BY sl.product_id
```

Index check: `sale_branch_occurred_idx` (branch, occurred) and `sale_line_sale_idx` (sale_id)
cover it. The plan runs `EXPLAIN (ANALYZE, BUFFERS)` on the seeded demo month and records the plan
in the evidence file; if it seq-scans `sale_line`, add `index('sale_line_product_sale_idx')` in a
small migration and record why.

### 2. `replenishment.service.ts`

```ts
export interface ReplenishmentRow {
  productId: string; sku: string; name: string
  supplierId: string | null; supplierName: string | null
  leadTimeDays: number; leadTimeAssumed: boolean
  minLevel: number; maxLevel: number | null; minOrderQuantity: number
  onHand: number; onOrder: number; unitsSold: number
  velocityDays: number
  targetLevel: number; coverageLevel: number; position: number
  suggested: number; basis: ReplenishmentSuggestion['basis']
  lastCostMinor: number
  suggestedValueMinor: number          // suggested × last cost, integer
}

export interface ReplenishmentGroup {
  supplierId: string; supplierName: string
  leadTimeDays: number; leadTimeAssumed: boolean
  rows: ReplenishmentRow[]
  totalValueMinor: number
}

export async function getSuggestions(user, query): Promise<{
  groups: ReplenishmentGroup[]
  unassigned: ReplenishmentGroup        // supplierId = '' — cannot become a PO until chosen
  totals: { rows: number; suggestedUnits: number; valueMinor: number }
}>
```

- `branchId = resolveBranchFilter(user, query.branchId)`; a manager's foreign branch is a 403.
- `leadTimeDays = sp.lead_time_days ?? (await getSettingValue('procurement.defaultLeadDays', {},
  tx))`, and `leadTimeAssumed = sp.lead_time_days === null`.
- `safetyDays = getSettingValue('procurement.safetyDays', { branchId }, tx)`.
- Every row calls `suggestReplenishment(...)`; the service performs **no arithmetic of its own**.
  That is the property that makes the number explainable: the screen renders the same inputs the
  function consumed.
- `suggestedValueMinor = suggested × lastCostMinor`, using `goodsValueMinor`-style validation.
- Sorting: groups by `supplierName`, rows by `suggestedValueMinor` descending then `sku`.
- `onlySuggested=true` filters `suggested > 0`; the default shows every threshold row so a manager
  can see a healthy part too.

`GET /api/replenishment/suggestions` — permission `procurement.read`. Query:
`branchId?`, `supplierId?`, `onlySuggested?` (`'true'|'false'`), `q?` (sku or name), `limit`,
`offset` applied to rows within the flattened result.

### 3. Supplier performance

```ts
export interface SupplierPerformanceRow {
  supplierId: string; supplierCode: string; supplierName: string
  ordersCount: number; linesCount: number
  onTimeLines: number; lateLines: number; noPromiseLines: number
  onTimeRateBasisPoints: number | null      // null when the denominator is 0
  orderedUnits: number; receivedUnits: number
  fillRateBasisPoints: number | null
  promisedLeadDaysAverage: number | null     // tenths, see below
  actualLeadDaysAverage: number | null
  lastCostDriftMinor: number | null
  lastCostDriftBasisPoints: number | null
  lastCostAt: string | null
}

export async function getSupplierPerformance(user, query): Promise<{
  from: string; to: string
  suppliers: SupplierPerformanceRow[]
  totals: { suppliers: number; onTimeRateBasisPoints: number | null; fillRateBasisPoints: number | null }
}>
```

Rules, exactly as P11-D11:

- **Window** is `from`/`to` over `purchase_order.submitted_at` (the date the order entered the
  world), default: the last 90 days. Inclusive `from`, exclusive `to`, Accra days via the existing
  shared helpers — not `new Date()` string surgery.
- **On time**: `firstReceiptDate <= expected_date`. Early counts as on time.
  `noPromiseLines` counts lines with no `expected_date`; the rate's denominator is
  `onTimeLines + lateLines` only, so unmeasurable lines never flatter or punish a supplier.
- **Fill rate**: `min(received, ordered)` summed ÷ ordered, over lines whose order has any receipt.
  Capped at 1.0 so an over-delivery cannot produce 110%.
- **Lead time averages** are returned in **tenths of a day** as integers
  (`actualLeadDaysAverageTenths`), computed from integer day differences; the console divides by
  10 for display only. Money and quantity stay integer; this is a display figure and is named so.
- **Cost drift**: latest receipt unit cost − the receipt before it, for the same
  `(supplier, product)`, summed across products that have two receipts, plus basis points against
  the previous cost using the shared percentage helper. Products with one receipt contribute
  nothing and are counted in `driftComparableProducts`.
- Only orders with `sent_at` contribute to lead-time figures; those without are counted in
  `ordersWithoutSendDate` and printed as an exclusion.

`GET /api/replenishment/suppliers/performance` — permission `procurement.read`; query
`branchId?`, `supplierId?`, `from?`, `to?`.

### 4. Raise an order from suggestions

`POST /api/procurement/orders/from-suggestions` — permission `procurement.create`:
`procurement.service.createOrderFromSuggestions(user, actor, input)`.

```ts
{
  branchId: string
  supplierId: string
  expectedDate?: string
  note?: string
  idempotencyKey: string
  lines: { productId: string; quantity: number; unitCostMinor?: number }[]
}
```

- One supplier per request; the console calls it once per group (P11-D10's Unassigned group cannot
  be submitted until a supplier is chosen).
- `unitCostMinor` defaults to `supplier_product.last_cost_minor`; a product with no link or a zero
  last cost is rejected with the product named, because an order with a zero cost would sail under
  any threshold.
- Creates a **`DRAFT`** order and returns it — a suggestion is a proposal, and a DRAFT lets the
  manager drop a line before submitting. The threshold applies on submit, as always.

### 5. Min/max editing

`inventory.validation.ts` `thresholdUpdateSchema` gains
`maxQuantity?: int 0..1_000_000` and `minOrderQuantity?: int 0..1_000_000` (both optional so the
existing callers keep working). `setThreshold` writes them; when `maxQuantity` is omitted on a
**new** row it defaults to `2 × threshold` (P11-D3's backfill rule, applied at the edge too).
Audit `stock_threshold.updated` carries all three values in before/after.

### 6. Tests

`replenishment.test.ts`:

| Fixture | Expectation |
|---|---|
| 900 sold, lead 7, safety 7, max 40, on hand 10 | row `suggested = 130`, `unitsSold = 900`, `velocityDays = 90`, `basis` present |
| 130 on open order | `suggested = 0` — the double-order guard (D9) |
| product with a threshold and **no `stock_level` row** | row exists, `onHand = 0`, suggested > 0 |
| product with no preferred supplier | in `unassigned`, not in a supplier group |
| `onlySuggested=true` | healthy rows excluded |
| manager requesting another branch | 403 |
| no `lead_time_days` on the link | `leadTimeDays = procurement.defaultLeadDays`, `leadTimeAssumed = true` |
| branch override of `safetyDays` | the branch value is used |

`replenishment.test.ts` — performance block, from fixtures with known dates:

- 3 lines, 2 on time and 1 late → `onTimeRateBasisPoints = 6667` (2/3);
- 1 line with no `expected_date` → excluded from the rate, counted in `noPromiseLines`;
- 100 ordered, 80 received → `fillRateBasisPoints = 8000`; 100 ordered, 120 received → `10000`,
  never above;
- sent Monday, first receipt Thursday → `actualLeadDaysAverageTenths = 30`; promised date a week
  after send → `promisedLeadDaysAverageTenths = 70`;
- a second receipt at 5 500 after 5 000 → `lastCostDriftMinor = 500`,
  `lastCostDriftBasisPoints = 1000`;
- an order with no `sent_at` → excluded from lead time and counted in `ordersWithoutSendDate`.

`procurement.test.ts`: `createOrderFromSuggestions` creates one DRAFT per call with the resolved
costs; a product with no supplier link is rejected by name; the order then submits under the
normal threshold rule.

`inventory.test.ts`: threshold update stores `maxQuantity` and `minOrderQuantity`, defaults
`maxQuantity` to `2 × threshold` on create, and audits all three.

## Verification

```bash
bun run --filter api test
bun run check-types
bun run lint
```

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT sl.product_id, sum(sl.quantity)
  FROM sale_line sl JOIN sale s ON s.id = sl.sale_id
 WHERE s.branch_id = $1 AND s.occurred_at >= now() - interval '90 days'
 GROUP BY sl.product_id;
```

Record the plan in `.planning/phases/11-procurement-replenishment/evidence/`. Then check one
suggestion by hand against the SQL — the numbers in the row must be reproducible from three
queries:

```sql
SELECT quantity_on_hand FROM stock_level WHERE product_id = $p AND branch_id = $b;
SELECT coalesce(sum(quantity),0) FROM sale_line sl JOIN sale s ON s.id = sl.sale_id
 WHERE sl.product_id = $p AND s.branch_id = $b AND s.occurred_at >= now() - interval '90 days';
SELECT coalesce(sum(pol.quantity),0) - coalesce(sum(srl.quantity),0)
  FROM purchase_order_line pol JOIN purchase_order po ON po.id = pol.order_id
  LEFT JOIN stock_receipt_line srl ON srl.purchase_order_line_id = pol.id
 WHERE pol.product_id = $p AND po.branch_id = $b
   AND po.status IN ('APPROVED','SENT','PARTIALLY_RECEIVED');
```

## Commits

1. `feat(api): replenishment read model and suggestion service`
2. `feat(api): supplier performance read model with stated dates`
3. `feat(api): raise a draft order from replenishment suggestions`
4. `feat(api): min, max and minimum order quantity on a threshold`
5. `test(api): suggestion arithmetic against hand-computed fixtures`

## Done when

- A suggestion row exposes every input it used, and the API performs no arithmetic beyond calling
  the shared function.
- On-order quantity stops a second order for the same part.
- A never-stocked part with a min/max row appears.
- Performance metrics name their dates, exclude what they cannot measure, and never exceed 100%
  on a fill rate.
- The velocity query's plan is recorded, not assumed.
