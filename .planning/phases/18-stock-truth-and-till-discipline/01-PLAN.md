# 18-01 — Stock visibility

**Must be true:** every active product appears at a branch even with no level, quantity 0,
flagged `neverStocked`; the inventory tab counts it as out of stock.

Tasks
1. `stock-threshold.sql.ts`: `effectiveThresholdSql(branchCol, thresholdCol)` and
   `DEFAULT_LOW_STOCK_THRESHOLD = 5`.
2. `selectStockPage` / `countStockRows`: `product` inner-join `branch` (all active branches when
   the scope is null), left-join `stock_level`, left-join `stock_threshold`; coerce quantity,
   threshold and updatedAt.
3. `stockConditions`: filter on `branch.id`, `coalesce(qty,0)`, low = `1…threshold`.
4. `StockRow` + `toStockRow`: `neverStocked`, `isLow` from the effective threshold.
5. `selectStockTotals`: same basis; `distinct_products` = rows, `out_of_stock = qty ≤ 0`,
   `low = 1…threshold`.
6. Console: "Never stocked" marker in the stock table.

Verification: api inventory + analytics suites, a new case for a never-stocked product.
