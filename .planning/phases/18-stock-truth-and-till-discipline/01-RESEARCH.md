# 18 — Research

## Repository facts (verified 2026-10-30)

| Fact | Where |
|---|---|
| `stock_level` rows are created on the first movement (`lockOrCreateLevel`) | `inventory.service.ts` |
| The stock list starts `FROM stock_level` with inner joins | `inventory.repository.ts:selectStockPage` |
| The inventory tab counts `FROM stock_level`, so a never-stocked product is invisible | `analytics.repository.ts:selectStockTotals` |
| `LOW_STOCK_SQL` requires `st.threshold IS NOT NULL` — no default threshold exists | `analytics.repository.ts:78` |
| `stock_threshold` is per product + branch (threshold, max, min order) | `inventory.schema.ts:125` |
| The till computes availability = `stock_level` + unacked `local_stock_delta` | `product-search.tsx` |
| The grid shows a badge but keeps the card clickable ("D16: the till never blocks") | `product-grid.tsx` |
| The till's badge threshold is hard-coded at 5 | `catalog/pricing.ts:stockBadge` |
| `ManagerOverrideDialog` exists and authorises against a permission + reason codes | `components/common/manager-override-dialog.tsx` |

## Industry position — selling at zero

Every system surveyed warns rather than refuses, because the customer is holding the item and
the stock record can be stale:

- **Shopify POS** — staff can keep selling at zero; POS warns. "Continue selling when out of
  stock" does not apply to POS.
- **Lightspeed** — negative-inventory warning with *Continue anyway* / *Mark unfulfilled*.
- **Odoo** — warning only; a hard stop requires custom code.
- **Cin7** — allows the sale and gives a discrepancy report (wait for stock / use another
  branch / adjust).
- **RetailEdge** — configurable: off / warn / warn + require an explicit confirmation.
- **Maropost (Retail Express)** — warns; the sale still completes.
- **Loyverse** — warns, and the warning does not work offline.

Sceptre Drive takes the strictest supported position (`BLOCK`) at the operator's request, but
keeps an authorised path so the rule is "never silently", not "never".

## Industry position — thresholds

- Default threshold for items without their own value, with a per-item override (Stockie,
  MyWorks, Stash).
- Stash's starting formula: `weekly consumption × lead time + buffer`; default alerts at 10
  when unset; critical at half the threshold.
- Stocky/Shopify: reorder point = lead time × sales per day, manually overridable per variant.
- Forstock: `ROP = average daily sales × lead time + safety stock`; do not use one flat rule
  for the whole catalogue.

Sceptre Drive starts with a flat default of 5 and a per-product override — the smallest thing
that works for a shop without consumption history yet, with room for a computed ROP later.

## Why the buckets are separate

Stockie and Shopify both list "out of stock" and "low stock" separately; a single bucket hides
an empty shelf behind a count. The dashboard therefore gets two figures.
