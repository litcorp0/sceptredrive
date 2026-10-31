# 17 — Research

Two questions, researched 2026-10-29/30. Repository facts first, then the sources.

## Repository facts (verified by reading the code)

| Fact | Where |
|---|---|
| `catalog.create` / `catalog.update` are admin-only; managers hold `procurement.create` | `packages/shared/src/permissions.ts` |
| A manager's product proposal becomes a `PRODUCT_CREATE` approval; nothing is inserted first | `products.service.ts:submitProduct` |
| Approval creates the product from the payload verbatim, one-shot | P11-D07, `createProductFromSubmission` |
| `product.cost_price_minor` is written only by a `RECEIPT` | `inventory.service.ts` → `updateDerivedCost` |
| `avg_cost_minor` moves only for `RECEIPT` / `TRANSFER_IN` | `inventory.service.ts:postMovements` |
| `sale_line.unit_cost_minor` = branch `avg_cost_minor` at sale time, default 0 | `pos.service.ts` |
| `adjustmentCreateSchema` has no `unitCostMinor` | `inventory.validation.ts` |
| `selectProductsForSale` already returns the whole product row | `pos.repository.ts:666` |
| Gross profit = `Σ base_minor − Σ unit_cost × qty`; margin = gp / base | `analytics.repository.ts` |

## The industry position — catalogue governance

- **The item master is central; branches receive an assortment.** Head office owns
  taxonomy, catalogue and price groups, and pushes to branches; branch managers review and
  accept. (Petrosoft PIM manual, for chains with a head-office/branch structure.)
- **New-product introduction is a gated workflow**: automated validation, duplicate
  detection, SKU setup, categorisation, enrichment, approval. Duplicate detection is named
  as a required validation, because "this will prevent duplicate items from being created
  in the retailer's environment with different identification numbers". (IBM, *Best
  practices for new product introduction*.)
- **Approvals should apply to designated attributes**, not to everything; permissions
  should reach attribute-group level, and read/edit/approve should be separable. Blanket
  approvals "slow everything and protect nothing". (PIM Selection, workflow requirements.)
- **The item does not change while the request is open**: proposed values are held on the
  approval and approving writes them; the requester cannot approve their own change. That
  is exactly what P11-D07 already does.
- **Duplicate handling in practice**: an exact name inside the same category is blocked
  outright; near-duplicates are surfaced with the conflicting record and a human decides.
  (AWRA item-master governance.)
- **Branch self-service exists, with a publish gate**: a branch that finds an existing item
  requests it be published to them; head office approves. (Youzan franchise product
  publishing.)

**Conclusion:** option A is the mainstream answer; field-scoped editing and duplicate
detection are the two things that make central governance bearable. Direct branch creation
(option B) is the pattern nobody recommends.

## The industry position — cost when nothing has been purchased

Every system surveyed hits the same case and every one of them documents the same failure:

- **Zeablue:** selling before the purchase order is receipted or landed costs are posted
  shows "a gross margin (GM) of 100% because the cost of goods sold (COGS) is $0", and a
  **cost variance journal** corrects it later.
- **QuickBooks:** a new item sold before any purchase "has no information from which to
  calculate the average cost, so it must assign an average cost of $0.00. This distorts your
  COGS", corrected when a bill establishes the cost. QuickBooks also treats **"Adjust
  Qty/Value On Hand"** as a first-class opening-balance operation.
- **Unleashed:** when there is no stock on hand, the **Last Cost** is used for an advisory
  margin, recalculated on dispatch; a zero ALC is called out as producing 100% margins.
- **Cin7 Core:** "If average cost is 0, margin will be N/A."
- **Sage 100:** offers **standard cost** as an alternative method, set on the item, with
  differences posted to an adjustment account.
- **NetSuite:** names this an "underwater sale" and shifts costing to the receipt date,
  posting an adjustment afterwards.
- **Finaloop:** missing cost data is assumed to be $0, which "leads to inaccurate COGS".

**Conclusion:** the standard combination is moving average (or FIFO) + a **last-cost
estimate** when the average is unknown + **variance** when the truth arrives. Reporting 0 as
100% margin is the one option no vendor presents as correct; those that address it show
`N/A`.

## Sources

- IBM, *Best practices for new product introduction* — duplicate validation, gated NPI workflow.
- Petrosoft, *Product Information Management manual* — head office vs branch responsibilities.
- PIM Selection, *Workflow and governance requirements* — attribute-level permissions, approvals.
- AWRA OpsHub, *Item master governance* — exact-duplicate block, near-duplicate scoring, held changes.
- Youzan help centre, branch product publishing — branch request → head office approval.
- Zeablue, *Cost variances* — 100% GM on $0 COGS, variance journal.
- QuickBooks, *Fix negative inventory* / *Adjust Qty/Value On Hand* — $0 average cost, opening balances.
- Unleashed, *Calculate sales margins* — last cost fallback, zero ALC warning.
- Cin7 Core, *Average cost* — margin N/A when average cost is 0.
- Sage 100, *Inventory costing methods* — standard cost and its adjustments.
- NetSuite, *Avoiding underwater inventory* — cost shifted to receipt, adjustment posted.
- Finaloop, *Units with missing costs* — zero-cost assumption distorts COGS.

Links are intentionally summarised rather than quoted at length; the claims above are the
parts that changed a decision.
