# 18-03 — Dashboard tiles

**Must be true:** the dashboard shows out-of-stock and low-stock as separate figures, each
linking to the stock list filtered accordingly.

Tasks
1. `AttentionCounts` + types + service: `outOfStockCount`.
2. Dashboard inventory KPI: out-of-stock and low-stock with links to `/inventory?stock=out|low`.
3. Stock page honours the filter.

Verification: analytics suite asserts both counts; console typecheck.
