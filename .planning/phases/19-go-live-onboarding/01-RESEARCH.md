# 19 — Research

Researched 2026-11-02. Repository facts first, then the external sources that shaped the
design.

## Repository facts (verified by reading the code)

| Fact | Where |
|---|---|
| A positive `FOUND`/`CORRECTION` adjustment may carry `unitCostMinor` and seeds the weighted average | `api/src/modules/inventory/inventory.service.ts` (`createAdjustment`, `postMovements`), `inventory.validation.ts` |
| `postMovements` values only `RECEIPT`, `TRANSFER_IN`, and a positive `ADJUSTMENT` that carries a cost | `inventory.service.ts:163-171` |
| `averageCostAfterReceipt` adopts the incoming cost when on hand is 0 or negative; it blends above 0 | `packages/shared/src/inventory.ts` |
| The adjust dialog exposes the cost field but calls it “Found stock” and claims adjustments never change the average cost | `admin/src/modules/inventory/components/adjust-dialog.tsx` |
| A manager's product proposal is a `PRODUCT_CREATE` approval; nothing is inserted first | `api/src/modules/products/products.service.ts:submitProduct` |
| Approval creates the product with `costPriceMinor: 0` and no stock | `products.service.ts:createProductFromSubmission` |
| After approval the console links to Inventory, not a prefilled stock action (18-05 carried) | `admin/src/modules/approvals/pages/approval-detail-page.tsx`, `18-SUMMARY.md` |
| Stock counts post `COUNT_VARIANCE` without a line cost; a go-live count would also distort count-accuracy metrics | `api/src/modules/counts/counts.service.ts:354-370` |
| Receipts already have a branch-scoped idempotency key and an immutable header/lines | `inventory.schema.ts`, `inventory.service.ts:createReceipt` |
| The movement type filter is derived from the pg enum, so a new type is filterable immediately | `inventory.validation.ts:71-79` |
| Bulk/CSV import was explicitly out of scope for v1 | `.planning/PROJECT.md` lines 53 and 128 |
| `skuSchema` accepts an optional SKU on admin create; the sequence advances past a supplied code | `products.validation.ts`, `products.service.ts:createProduct` |
| Document numbering is branch/month, settings-prefixed, and lock-safe | `api/src/modules/platform/sequences.service.ts` |

## External sources

### SAP Business One — opening balances are a cutover document

SAP's opening-balance guidance treats inventories as part of the cutover: item quantities and
costs are entered as of the go-live date, and the go-live date is the recommended date for
the opening-balance window so the opening can be reported as of the first day of trading.

- <https://help.sap.com/docs/SAP_BUSINESS_ONE/25bde9551224405e84e69c760e272e89/5c892e55e4e51e0be10000000a441470.html>
- <https://help.sap.com/doc/saphelpiis_hc_b1_image_repository_consultant_training_basic_b1_90_tb1200_04_05_pdf/9.0/en-US/B1_90_TB1200_04_05.pdf>

**Consequence for us:** opening is a dated, valued document; it is not a purchase.

### Odoo — physical inventory / inventory adjustment

Odoo's opening-stock flow is the Physical Inventory view: enter counted quantities and let
the adjustment post the difference. It is a stock adjustment, not a vendor bill.

- <https://www.odoo.com/documentation/20.0/applications/inventory_and_mrp/inventory/warehouses_storage/inventory_management/count_products.html>
- <https://www.odoo.com/documentation/20.0/applications/inventory_and_mrp/inventory/inventory_valuation/cheat_sheet.html>

**Consequence for us:** counted quantity, not “add this many”, is the right input.

### Lightspeed Retail — the workaround we are replacing

Lightspeed tells migrating shops to count in the old POS, import items at quantity 0, and
then set opening quantity through a purchase order with a **mock vendor** named “Lightspeed
Go Live”. That is exactly the fake-receipt pattern the operator hit; it exists because the
product lacks a first-class opening document.

- <https://retail-support.lightspeedhq.com/hc/en-us/articles/360036153334-Migrating-inventory-from-your-previous-POS>

**Consequence for us:** the industry need is real and common; Sceptre Drive can do better
because it already has a valued movement primitive.

### QuickBooks — Adjust Qty/Value On Hand

QuickBooks treats “Adjust Qty/Value On Hand” as the opening-balance operation and documents
that selling before a cost exists produces a zero-COGS, 100%-margin distortion. Phase 17
already adopted the same position (`marginBp: null`, `uncostedRevenueMinor`).

**Consequence for us:** cost is part of the opening, not an optional afterthought.

### Ghana VAT — cost basis and pre-registration stock

While the business is not VAT-registered, VAT paid is part of the cost of the stock. Ghana
allows a newly registered taxable person to recover input VAT on stock still owned and
purchased within a short window before registration (PwC cites four months for stock and six
for capital goods; confirm with the accountant). Keeping supplier invoices and purchase
dates matters for that future claim.

- <https://www.pwc.co.za/en/publications/vat-in-africa/ghana-overview.html>
- <https://gra.gov.gh/wp-content/uploads/2020/09/vat_act_870.pdf>

**Consequence for us:** record the actual cost paid; do not invent a VAT-exclusive cost.
Opening stock does not create a payable; unpaid stock is a standalone supplier invoice.

## The conclusion that drove the plan

The mainstream answer is a **count-based opening balance, dated at go-live, valued at cost,
posted once, and corrected afterwards by compensating movements**. Sceptre Drive has every
primitive except the document and the bulk path. Building those is a smaller, safer change
than teaching the receipt flow to pretend a purchase happened.
