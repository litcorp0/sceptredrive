# 18-02 — Default threshold of 5

**Must be true:** a product with no `stock_threshold` row is still low at 1…5 and out at 0; an
explicit row wins; the setting is branch-scoped and manager-writable.

Tasks
1. Setting `inventory.defaultLowStockThreshold` (int ≥ 0, default 5, branchScoped,
   writableBy manager).
2. `effectiveThresholdSql` used by the stock list, the inventory totals and the attention
   counts (replacing `LOW_STOCK_SQL`'s threshold requirement).
3. `selectAttention` returns `lowStockCount` and a new `outOfStockCount`.
4. Console settings meta: label + help for the new key.

Verification: analytics attention + inventory totals with/without a threshold row.
