# 17 — Summary

**Implemented:** 2026-10-30. All five plans landed; the two operator decisions from the
conversation (keep the item master central; last-cost fallback + honest margin) are in code.

## What shipped

| Plan | What it does now | Proof |
|---|---|---|
| 01 | Same name in the same category → `409 PRODUCT_DUPLICATE` naming the existing SKU; a barcode another product owns → `409 BARCODE_IN_USE`; both checked at create **and** at a manager's submission | 5 new cases in `products.test.ts` |
| 02 | `catalog.describe` (manager + admin): a manager may change the description and is refused any real change to name, category, unit, brand, base price, tax category or SKU — in the **service**, not the console. Unchanged protected values are tolerated because the form posts everything | 2 new cases + permission test |
| 03 | A sale costs the branch average, else the product's last receipt cost (`product.cost_price_minor`), else zero | 3 new cases in `pos.test.ts` |
| 04 | `marginBp` is `null` when every sold unit had no cost; the overview and products report expose `uncostedRevenueMinor` and `uncostedLines`; per-product rows report `null` rather than 100%; the console says "No cost known — GH₵ X sold without one" | `marginWhenCosted` unit test + existing analytics suite |
| 05 | A positive `FOUND`/`CORRECTION` adjustment may carry `unitCostMinor`, seeds the weighted average and stores the cost on the movement; a negative adjustment carrying a cost is refused; the catalogue's last receipt cost is untouched | new API case in `inventory.api.test.ts` |

Console: the adjust dialog offers an optional unit cost for opening stock; the product form
lets a manager edit the description only; the dashboard and products tab explain an unknown
margin instead of printing a dash with no reason.

Copy corrected after the phase (2026-10-30): the proposal form said cost comes from goods
receipts "never from this form", which stopped being the whole truth once an opening-stock
adjustment could set a branch average. It now names both sources and says that until one
exists the product reports no margin. The product page's "no receipt yet" line says the same
thing, because a product with no purchase can still be costed by opening stock.

## Numbers

- shared **355** (+5), desktop **616**.
- API: affected modules **391** across 27 files; **full suite 865 across 62 files**, green.
  (One earlier full run reported `evat.test.ts` failing — that was a second suite run
  started concurrently by mistake, cleaning up the first one's fixtures. The same test
  passes 21/21 alone and the clean full run is green. Recorded because the same symptom
  appears in STATE's Phase 14 notes.)
- `check-types` **7/7** (including `web`), `lint` exit 0, `brand:check` 1 270 files,
  `modules:check:strict` 21/21 admin and 16/16 POS.
- **Not run:** `test:counter` (Electron + PowerSync), which is the suite that covers the
  till-side changes in this phase.

## Deliberately not built

- **Cost variance** for sales made before the first receipt (D7). Still the accounting-grade
  answer, still a later phase: it needs its own append-only document.
- **Near-duplicate scoring** (D3). Only the exact name case is refused; a scored warning is
  a good next step once the catalogue has real volume.
- **Branch-local products** (D1, option C). The item master stays central.
- A second, user-typed cost field (D8). The last-cost fallback is derived, as P11-D13
  requires.

## Notes for the next reader

- `selectLineTotals` and `selectProductTotals` now count uncosted revenue with a `FILTER`;
  a fully costed window behaves exactly as before, which is why the existing analytics
  assertions still pass unchanged.
- The sale-cost precedence lives in one function, `costForSale`, so a future method (FIFO,
  standard cost) replaces one call site rather than five.
- `web/` is a workspace with its own Biome root, so the repository `bun lint` excludes it;
  `bun run --filter web check` covers it. Unifying them means setting `"root": false` in
  `web/biome.json`.
