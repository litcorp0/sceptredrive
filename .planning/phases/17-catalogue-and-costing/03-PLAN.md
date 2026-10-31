# 17-03 — A sale's cost falls back to the last receipt cost

**Goal:** a product bought once anywhere sells with a real cost at a branch that has never
received it, instead of costing nothing.

**Must be true when done**

- `sale_line.unit_cost_minor` = the branch's `avg_cost_minor` when it is greater than zero.
- Otherwise it is `product.cost_price_minor` — the last receipt cost anywhere in the company.
- Otherwise it is zero, and plan 04 makes that visible.
- No extra query: `selectProductsForSale` already returns the whole product row.
- A refund keeps the sale line's frozen cost (unchanged behaviour).

## Tasks

1. `pos.pricing.ts`: add `costPriceMinor` to `SaleCatalogLine` and map it from `row.product`.
2. `pos.service.ts#applySale`: replace `posted.levels.get(id)?.avgCostMinor ?? 0` with a
   named helper `costForSale(branchAverage, productCost)` so the precedence is in one place
   and testable.
3. Tests in `pos.test.ts`: a product with no branch level but a non-zero
   `product.cost_price_minor` stores that cost; a product with a branch average stores the
   average even when the product cost differs; a product with neither stores 0.
4. Regression: the existing clean-sale test still stores the branch average.

## Notes

- P11-D13 stays intact: the fallback is a **derived** figure, never typed by a user.
- A zero-cost receipt (free stock) legitimately leaves the average at 0, so the fallback
  applies. That is the intended reading of "no cost known here".

## Verification

`bunx vitest run src/modules/pos/pos.test.ts`; three new cases plus the existing sale cases.
