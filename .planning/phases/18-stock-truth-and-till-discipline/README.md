# Phase 18 — Stock truth and till discipline

**Goal:** "no stock on record" and "zero on the shelf" mean the same thing — in the stock list,
in analytics, on the dashboard, and at the till — and a product that cannot be sold says so
before it reaches the cart.

## The bug behind the report (2026-10-30)

`stock_level` rows are created lazily, on the first movement, and every inventory read starts
`FROM stock_level`. A product that has never moved at a branch therefore does not exist to
inventory, analytics or thresholds:

- the stock list hides it (two catalogue items, one row),
- the analytics inventory tab counts it in neither `distinct_products` nor `out_of_stock`,
- `LOW_STOCK_SQL` requires a `stock_threshold` row that nobody creates, so low stock never fires,
- the till shows an "Out of stock" badge and still sells it, by design (D16).

## Plans

| # | Plan | Lane |
|---|---|---|
| 01 | Stock visibility: every active product at the branch, never-stocked state | api + admin |
| 02 | A default low-stock threshold (5), per-product override wins | api + admin |
| 03 | Dashboard out-of-stock and low-stock tiles | api + admin |
| 04 | Till: search-only catalogue, out-of-stock blocked with a manager override | desktop + shared |
| 05 | Approval → stock: a new product cannot go live invisible | admin |

## Decisions (operator, 2026-10-30)

- **Out of stock at the till: block, with a manager PIN override.** The override adds the line
  and the sale still records `STOCK_OVERSELL`, so AGENTS' "never lose a sale" survives as an
  explicit, authorised path rather than a silent one.
- **Low stock: default 5, `1…5` is low, `≤ 0` is out of stock.** The buckets are disjoint so
  one cannot hide the other; a manager may override the threshold per product.

## Verification

1. A product with no stock row appears in the branch's stock list at 0, marked never stocked.
2. The inventory tab's out-of-stock count includes it; the low-stock count uses the default 5.
3. An explicit per-product threshold still wins over the default.
4. The dashboard shows out-of-stock and low-stock as separate figures.
5. An empty search at the till shows no product cards; an out-of-stock hit is dimmed and not
   clickable; a manager PIN adds it and the sale records an oversell conflict.
