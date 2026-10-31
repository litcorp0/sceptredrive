# 17 — Context and decisions

**Locked:** 2026-10-29, operator conversation. **Owner decisions confirmed:** yes, both.

## What we found (verified in the repository)

- `catalog.create` and `catalog.update` are **admin-only** (`packages/shared/src/permissions.ts`).
  Managers hold `procurement.create`, which is the door to `POST /api/products/submissions`
  → a `PRODUCT_CREATE` approval. Approval creates the product **exactly as submitted**
  (P11-D07) and the request is one-shot.
- Products are **company-wide**; only prices are branch-scoped (`product_price`). There is
  no such thing as "a product for this branch" today.
- `product.cost_price_minor` is **derived and read-only** (P11-D13): written *only* by an
  inbound `RECEIPT`, never by a human, because "two writable cost figures is how margin
  reporting loses trust".
- `sale_line.unit_cost_minor` is frozen at sale time from `stock_level.avg_cost_minor`,
  which only an inbound `RECEIPT` or `TRANSFER_IN` moves. A product that was never
  received therefore sells at cost **0**.
- Gross profit is `Σ(base_minor) − Σ(unit_cost_minor × quantity)`; with cost 0 the margin is
  **100%**, with no signal that it is meaningless.
- `adjustmentCreateSchema` has **no** `unitCostMinor`, so opening stock cannot carry a cost.
  A receipt is the only door, and its supplier fields are optional.

## D1 — Keep the item master central (option A)

Managers do not create products directly. They keep proposing, and the admin keeps
deciding. Industry practice is unambiguous here: the catalogue is the one place duplicate
SKUs and barcode collisions are born, and every ERP-grade system keeps it central while
giving branches an *assortment*. Branch-local records (option C) are a later decision if
the branch count grows.

**Rejected:** direct create/edit for managers (option B). It is the change that fills a
catalogue with three spellings of one product, three stock levels and three cost histories.

## D2 — Editing is field-scoped, not all-or-nothing

A manager may edit the **description**. Name, category, brand, unit, tax category, base
price and barcodes stay admin/approval territory. This is the governance pattern ("approvals
should apply only to designated attributes"), and it unblocks the common case — a manager
fixing a typo — without opening identity.

Enforced in the **service**, not just hidden in the console (OWASP A01: a client that sends
the field anyway is refused).

## D3 — Duplicate detection happens at submit and at create

Exact `name` (trimmed, case-insensitive) inside the same category is refused with
`PRODUCT_DUPLICATE`, naming the existing SKU. A barcode already owned by another product is
refused with `BARCODE_IN_USE` instead of surfacing a database unique violation as a 500.
Near-duplicates are **not** scored in this phase; the exact case is the unarguable one.

## D4 — A sale's cost falls back to the product's last receipt cost

`product.cost_price_minor` already holds the last purchase price anywhere in the company and
`selectProductsForSale` already loads the whole product row, so the fallback costs no schema
change and no extra query. It is the industry-standard "last cost" estimate (QuickBooks Item
Cost, Unleashed Last Cost), and it keeps P11-D13 intact: the figure stays **derived**, never
typed.

Precedence: branch average cost when it is greater than zero, otherwise the last receipt
cost, otherwise zero.

## D5 — Zero cost is reported as unknown, never as 100%

With no cost anywhere, `marginBp` is `null` and the overview exposes
`uncostedRevenueMinor`, so the console can say "no cost known" instead of printing a number
that flatters the business. Per-product rows carry `marginBp: null` for the same reason
(Cin7's behaviour: "if average cost is 0, margin will be N/A").

## D6 — Opening stock may carry a cost

A **positive** `FOUND` or `CORRECTION` adjustment may carry `unitCostMinor`; it seeds the
branch weighted average exactly like a receipt, and the movement records the cost.
A negative adjustment never changes the average — it removes stock at the cost that is
already there. This is parity with an opening-balance operation (QuickBooks "Adjust
Qty/Value On Hand") and removes the current need to fake a receipt.

## D7 — Cost variance is a later phase, not this one

Correcting historical profit when a receipt lands after the sale is the accounting-grade
answer, and it is a new append-only document with its own table, screens and reconciliation.
Recorded here so it is not lost; deliberately not built now.

## D8 — No new cost field

No user-typed "standard cost", no second column. Standard cost is for manufacturing and for
businesses with stable costs; a shop buying from suppliers is best served by moving average
plus last cost, which is what this phase implements.
