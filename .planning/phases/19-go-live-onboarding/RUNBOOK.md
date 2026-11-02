# Go-live runbook — bringing an already-trading branch onto Sceptre Drive

This is the human sequence behind Phase 19. It assumes the branch already owns stock and is
already selling. The system's opening document is a **count**, not a purchase: do not use a
goods receipt, and do not run SQL against production.

## Before the day

1. **Pick a quiet window.** The count is a snapshot; sales during it make the snapshot stale.
   A morning before opening, or after close, is the right shape.
2. **Take a physical count by shelf.** Record the product, barcode (if any), unit cost and
   quantity on a count sheet. The shelf wins over the old system's quantity — the old number
   is only a cross-check.
3. **Separate the three cases.** A product the system has never held is opening stock. A
   product whose shelf count is *lower* than the system's is shrinkage: post a stock count or
   a write-off, not an opening. A product with no cost known is uncosted: record it as such
   deliberately, or find the purchase price before the load.
4. **Back up and export.** Take a final export/backup of the old system and record the time.
   Keep it.
5. **Check the catalogue references.** Every category, unit and brand in the file must exist
   in the console. The importer refuses an unknown one rather than inventing it.
6. **Choose the cost.** While the business is not VAT-registered, VAT paid is part of cost.
   Ghana allows a newly registered business to recover input VAT on stock still owned and
   bought within a short window before registration (PwC cites four months for stock; confirm
   with the accountant). Keep the supplier invoices and purchase dates.
7. **Decide what is not coming.** Historical sales, customer and credit balances, loyalty
   balances, previous receipts and supplier debts are not migrated by this document. Record
   an unpaid supplier debt as a standalone supplier invoice (Phase 5); do not fake a receipt.

## The file

CSV with this header (case-insensitive; extra columns are ignored):

```csv
name,category,unit,price,cost,quantity
Brake pad,brakes,piece,120.00,80.00,12
Oil filter,oil,filters,piece,45.00,30.00,20
```

Optional columns: `sku` (matching only — an unknown SKU is an error; leave it blank to create
a product with a system SKU), `barcode`, `brand`, `taxCategory` (`STANDARD`, `ZERO_RATED`,
`EXEMPT`).

Rules the preview enforces:

- one row per product; a duplicate is an error;
- a new product needs a price and a category and unit;
- a line with quantity > 0 needs a cost; a zero cost is allowed only as an explicit uncosted
  line, and needs the admin's acknowledgement at post;
- a shelf count below the system's on-hand is refused — use a stock count or write-off;
- the file is capped at 5,000 rows / 2 MB.

## The day

1. **Manager:** Inventory → Opening stock → New opening. Upload the file (or paste it) and
   press **Preview**. Fix every row error; read the warnings (existing price unchanged, extra
   units blended, uncosted line).
2. **Manager:** **Save draft.** The ledger does not move. Send the admin the document number.
3. **Admin:** open the draft, read the lines and the counted value, and **Post opening**.
   If there are uncosted lines, tick the acknowledgement first. The post creates any new
   products, appends one `OPENING` movement per positive delta, and stamps the value.
4. **Sync the terminals.** A till that has not synced since the post still sees the old level.
   Check the sync badge, then ring a test sale and confirm the stock falls and the receipt's
   margin is not 100%.
5. **Resolve the pre-opening conflicts.** Any `STOCK_OVERSELL` conflict raised while the
   shelf was at zero is now explainable; a manager reviews and resolves it in Operations →
   Conflicts. Do not auto-resolve them.
6. **Sign off.** Record the document number, the count date, the counted value and who
   counted/posted. Keep the count sheet and the CSV with the sign-off.

## After the day

- Corrections are **stock counts, write-offs or adjustments**, never edits to the posted
  opening. The document is immutable.
- A second branch gets its own opening document. The same document never spans branches.
- The stock report's movement filter shows `OPENING` and its value; the stock value is the
  projection, now.
- Sales rung before the opening stay uncosted. The dashboard's uncosted-revenue figure names
  them; the phase does not rewrite history. Retroactive cost variance is a separate,
  append-only document (Phase 17 D7).

## What this phase does not migrate

- Historical sales and their receipts.
- Customer records, credit balances and loyalty points.
- Supplier balances and previous purchases.
- Old SKU codes, unless the operator chooses to keep them (this phase uses system SKUs).
- Branch assortment (which products a branch is meant to carry).

Those are separate onboarding tracks; mixing them into the opening is how a stock count turns
into an unreconcilable data project.
