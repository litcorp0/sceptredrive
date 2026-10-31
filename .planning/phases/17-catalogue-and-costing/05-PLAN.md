# 17-05 — Opening stock may carry a cost

**Goal:** stock the business already owns can enter the ledger with what it cost, without a
fake supplier receipt.

**Must be true when done**

- A **positive** `FOUND` or `CORRECTION` adjustment may carry `unitCostMinor`.
- That cost seeds the branch weighted average exactly like a receipt, and the movement stores
  it.
- A **negative** adjustment never changes the average cost, and a cost sent with one is
  refused rather than silently ignored.
- Shrinkage reasons (`DAMAGE`, `LOSS`, `EXPIRED`, `OTHER`) still go through the write-off
  request for a manager, unchanged.
- An adjustment without a cost behaves exactly as today (quantity moves, average untouched).
- A sale after the opening stock uses the seeded average.

## Tasks

1. `inventory.validation.ts`: `unitCostMinor` optional on `adjustmentCreateSchema`.
2. `inventory.service.ts#createAdjustment`: allow it only when `quantityDelta > 0` and the
   reason is `FOUND` or `CORRECTION`; otherwise `ValidationError` naming the rule. Pass it to
   `postMovements`.
3. `inventory.service.ts#postMovements`: treat an `ADJUSTMENT` carrying a cost as inbound for
   valuation — weighted average via `averageCostAfterReceipt` — while a negative delta keeps
   the current average. The movement's `unitCostMinor` records the supplied cost.
4. `inventory.repository.ts`: no change expected; confirm `updateDerivedCost`'s rule (receipt
   only) still holds, so an adjustment does not rewrite the catalogue's last receipt cost.
5. Console: the adjust dialog shows an optional unit cost when the reason is `FOUND` or
   `CORRECTION` and the quantity is positive.
6. Tests in `inventory.test.ts`: opening stock seeds the average; a later sale uses it; a
   negative adjustment with a cost is refused; a negative adjustment without one leaves the
   average; the catalogue cost is unchanged by an adjustment.

## Notes

- This is the only plan in the phase that can change stock value, so it runs last and its
  tests assert the average either side of every case.
- `product.cost_price_minor` stays receipt-only on purpose (P11-D13); opening stock is a
  branch fact, not a purchase price.

## Verification

`bunx vitest run src/modules/inventory`, with the five cases above, and the existing
adjustment tests unchanged.
