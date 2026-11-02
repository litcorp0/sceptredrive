# 19 — Context and decisions

**Locked:** 2026-11-02, operator conversation. **Owner decisions confirmed:** yes, all seven.

## The situation

A branch is already trading and already owns stock. The catalogue is being filled one
product at a time: a manager proposes, an admin approves, and the product is born at
quantity 0. The only door the operator could find was a goods receipt, which is wrong twice:
it invents a purchase that did not happen, and it attributes the goods to a supplier who
never sold them.

The repository already has the primitive for this. Phase 17-05 lets a positive `FOUND` or
`CORRECTION` adjustment carry `unitCostMinor`, and `postMovements` seeds the branch weighted
average exactly like a receipt. What is missing is **scale and meaning**: one product per
dialog, no document, no sign-off, no go-live report, and console copy that still says an
adjustment never changes the average cost.

## Operator decisions

| # | Decision | Answer |
|---|---|---|
| D1 | Where the branch is | **Already selling, with stock.** This is a current cutover, not a pre-go-live load. |
| D2 | Onboarding size | **250–1,000 lines.** Bulk is required. |
| D3 | Who posts | **Manager drafts, admin posts.** The admin signs off the value. |
| D4 | Scope | **Products + opening stock.** One combined go-live document. |
| D5 | Product proposal | **A manager's proposal may carry opening quantity and cost**, approved in the same decision. |
| D6 | Product codes | **System-generated SKUs.** No legacy code field. |
| D7 | Historical cost | **Accept uncosted history.** Sales already rung at cost 0 stay as they are; margin is fixed from the opening forward. |

## Design decisions

### D8 — One combined go-live document, not two imports

An opening file with no legacy SKU has no reliable key to match against. Matching 1,000
rows by name alone is how duplicate catalogues are born. The document therefore carries the
catalogue row and the counted stock together:

- a row that matches an existing product by barcode, by SKU (if the operator typed one), or
  by exact trimmed name + category, stocks that product;
- a row that matches nothing becomes a **new product**, created at post time by the admin;
- existing products are never renamed and their prices are never changed by this document.

This keeps the admin as the approver (they post the document), while making the bulk load a
single review instead of 1,000 separate `PRODUCT_CREATE` decisions.

### D9 — Counted quantity, not a delta

The operator counts the shelf. Each line stores the **counted quantity**; posting computes
`delta = counted − current on hand` at that moment. Re-uploading a count therefore cannot
silently double the stock, and a product already oversold (negative on hand) is corrected in
the same movement.

### D10 — Additive only

An opening line must have `delta ≥ 0`. If the system says 5 and the shelf says 4, that is
shrinkage, not opening stock: it belongs in a stock count or write-off. Keeping the two
facts apart is what makes the opening report trustworthy.

### D11 — Cost is required, and zero is explicit

A line with quantity > 0 must carry a unit cost greater than zero. A zero-cost line is
allowed only with an explicit uncosted acknowledgement and is counted and displayed as
uncosted. This is the Phase 17 rule: no silent 100% margin.

### D12 — Cost behaviour

`postMovements` uses the stated cost for an inbound `OPENING` movement:

- on hand ≤ 0 → the stated cost becomes the branch average exactly (`averageCostAfterReceipt`
  already adopts the incoming cost in this case);
- on hand > 0 → the extra units blend at the stated cost, and the preview says so.

A negative delta never changes the average; the opening document does not permit one.

### D13 — Draft, then post; append-only afterwards

`DRAFT` documents can be edited by deleting and re-importing, and deleted outright. `POSTED`
documents are immutable. Corrections are counts and adjustments, never edits. A posted
document cannot be voided in this phase; a mistake is corrected by the compensating
movement a manager would use anyway.

### D14 — Idempotency and one transaction

Create carries a client idempotency key unique per branch. Post locks the header and is
idempotent: a retry returns the already-posted document. Creating new products and posting
every movement commit or roll back together; there is no partial go-live.

### D15 — Authority is server-side

`inventory.opening.draft` (manager + admin) creates a draft; `inventory.opening.post`
(admin only) posts it. Reads use `inventory.read`. A manager can only draft at their own
branch; the branch is checked in the service, not only in the console (OWASP A01).

### D16 — The proposal carries its own opening stock

`PRODUCT_CREATE` submissions gain optional `openingQuantity` and `openingUnitCostMinor`.
Both or neither. Approving creates the product and posts a one-line opening document in the
same transaction; rejecting posts nothing. This is the everyday path; the bulk document is
the go-live path.

### D17 — The catalogue cost stays receipt-only

`product.cost_price_minor` is still written only by a `RECEIPT` (P11-D13). Opening stock is a
branch fact: it sets `stock_level.avg_cost_minor`, which is what a sale at that branch uses.
Other branches get their own cost when they receive or open stock.

### D18 — What is deliberately not migrated

Historical sales, customer and credit balances, loyalty balances, supplier debts and
previous receipts. The dashboard starts at go-live. Unpaid stock is recorded as a standalone
supplier invoice (Phase 5 already supports opening debts), never as a fake receipt.

## Known limits recorded at planning time

- Sales rung before the opening stay uncosted; the analytics uncosted-revenue figure names
  them. Retroactive cost variance remains the Phase 17 D7 follow-up.
- Existing products' prices are not changed by the opening. A price difference is a price
  change, with its own band and audit.
- The file cap is 5,000 rows; the target is 1,000. Larger loads are split by branch or
  category.
- A terminal that has not synced since the posting can still see the old level; the runbook
  requires a sync check before the next sale.
- The document is per branch. A second branch posts its own.
