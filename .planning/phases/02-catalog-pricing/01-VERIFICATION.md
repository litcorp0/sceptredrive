---
phase: 02-catalog-pricing
plan: 06
title: Phase 2 verification — Catalog & Pricing
status: verified
verified: 2026-10-18
verifier: agent (browser + API walkthroughs; screenshots kept in evidence/)
---

# Phase 2 — Catalog & Pricing — Verification

**Goal proven:** a fitment-free product catalog with SKUs, barcodes, categories, brands,
units, prices, and correct Ghana tax is fully managed in the admin console.

**Environment:** dev database dropped and recreated (`gikautos`), migrations applied,
`db:seed` + `db:seed --demo` run twice (idempotent), API (`:4000`) and admin console
(`:3000`) running. Verification drove the same HTTP endpoints the console uses, plus a
real Chromium browser walkthrough of the console UI with a live API and database.

**Evidence scripts** (throwaway, copied for reproduction):
`evidence/walkthrough-wave2.mjs` (API-as-browser flow) and
`evidence/walkthrough-browser.mjs` (Playwright UI flow). Key screenshots:
`evidence/03-categories.png`, `evidence/05-product-editor.png`,
`evidence/06-list-effective.png`, `evidence/08-manager-override.png`.

## Success criteria

### 1. Admin creates a category, brand, unit, product, barcode, and price — PASS

Browser walkthrough (real UI, fresh DB): admin signs in past **forced TOTP setup**
(TOTP enabled and verified end to end — this closes the Phase 1 human item), then
creates a two-level category tree, a brand, a unit (code uppercased), and a product
using the **suggested SKU**, an EAN-style barcode chip, and a GHS 100.00 base price;
saving opens the product editor where the barcode persisted. The API walkthrough also
proves creation with a manual SKU and the atomic allocation path (`suggest` twice →
unchanged; save → creates at the suggested value).

### 2. Duplicate barcodes and SKUs rejected with clear errors — PASS

Both walkthroughs: duplicate barcode → 409 naming the code
(`Barcode WEBxxxx01 is already in use`); duplicate SKU → 409
(`A product with this SKU already exists`). Console surfaces these inline in the form
(409 handled in the product form and the catalog dialogs). Integration tests cover
both plus case-insensitive duplicates for category and brand names.

### 3. Manager sets an override for their branch only; effective price reflects it — PASS

- Manager on own branch (`ACC-SPX`) → 200; another branch → 403; admin any branch → 200.
- Effective price shown in the product list differs from the base after the override,
  for the manager (own branch) and for the admin scoping to that branch; admin with no
  branch sees `effectivePriceMinor: null`.
- Console: overrides panel shows only the manager's branch; the Effective column only
  appears when a specific branch is active (browser screenshots).
- Shared `resolveEffectivePrice` is unit-tested and reused by the API; an API test
  asserts the list value equals the shared function's result.

### 4. Tax computed correctly for inclusive prices — PASS

- Unit tests: GRA worked example (GHS 1,000 → NHIL 2.50, GETFund 2.50, VAT 15.00,
  total 120.00), inclusive inverse, and the residual invariant
  `base + vat + nhil + getfund === total` for **every** amount 0…200,000 pesewas in both
  modes; invalid inputs throw.
- Console preview in the browser matches the engine: GHS 100.00 inclusive → base 83.33,
  VAT 12.51 (residual-adjusted), NHIL 2.08, GETFund 2.08, total tax 16.67; switching
  `pricing.taxMode` to EXCLUSIVE live flips the preview (100.00 → VAT 15.00, total
  120.00), then reverted to INCLUSIVE.
- All amounts are integer minor units end to end (no floats in stored or computed money).

### 5. Product search finds by name, SKU, and barcode — PASS

- API tests: name substring (trigram), SKU prefix, exact barcode; category filter
  includes subcategories; brand filter; archived hidden by default; pagination stable.
- Browser: searching the exact barcode finds the row and shows the effective override
  price with the branch selected; archived products hidden unless "Show archived".

## Additional verification

- **Archive guards**: category archive blocked while it has active subcategories or
  active products; brand/unit archive blocked while active products reference them;
  reactivating a child is blocked while its parent is archived. All 409s surfaced
  verbatim in the console (tests + `evidence` screenshots).
- **Audit**: every catalog mutation writes an in-transaction audit row
  (`category.*`, `brand.*`, `uom.*`, `product.*`, `product.price.override_*`); tests
  assert actor and before/after payloads.
- **Permissions**: admin-only catalog writes and base/cost price edits; managers read
  everything and set own-branch overrides; the console hides actions managers cannot
  perform (browser walkthrough confirms none are rendered).
- **Fresh database**: migrate → seed → demo seed repeated twice; counts stable
  (12 categories, 12 products, 14 barcodes, 1 override, sequence at 13); the trigram
  GIN index is created by the migration (`CREATE EXTENSION IF NOT EXISTS pg_trgm`).
- **Quality gates**: `bun run lint` clean (210 files); `bun run check-types` clean
  (api, admin, shared, db); `bun run test` — shared 40/40, api 146/146;
  `bun run build` (admin SSR) passes.
- **Walkthroughs**: API-as-browser flow 31/31 on the fresh DB; Playwright UI flow
  29/29 (admin + manager sessions).

## Deviations from plan text

1. **Category `PATCH` excludes `isActive`** (plan listed it as an update field).
   Archiving goes only through the guarded archive/reactivate endpoints so the
   archive guards cannot be bypassed with a bare PATCH.
2. **SKU sequence advances with saved suggestions** (beyond the plan's
   "suggest does not consume; races simply 409"). Found by the live walkthrough:
   saving the suggested SKU left the next suggestion stale and every following
   auto-allocation collided. `advanceSequencePast()` now bumps the counter past a
   saved `GIK-…` SKU on create and SKU-changing update (commit `fa04824`), with a
   regression test. Missing references return 404; inactive references return 409.
3. **Brand validation on update only runs when the value changes** (commit `f01bcb7`);
   editing a product that keeps an archived brand no longer 409s.
4. **Products list route flattened** (`products/index.tsx` under a thin
   `products.tsx` layout, commit `7f4f582`): flat-file child routes (`products.new`,
   `products.$id`) never rendered because the list had no `Outlet`; found by the
   browser walkthrough.
5. **Seed test cleanup scoped to demo data** (commit `c226051`) so branch deletes no
   longer trip the new `product_price` restrict FK; the seed test additionally
   asserts product/barcode/override counts.
6. **Guard counters live in `products.service`** (called service-to-service from
   `catalog.service`) — avoids a module cycle while Plan 03 needed product counts
   before the products module landed in Plan 04.

## Human verification still valuable

- A visual pass over `evidence/*.png` (or re-running the browser walkthrough) to
  confirm the console styling matches taste; the flow itself is machine-verified.
- The dev-environment TOTP secret lives at `/tmp/opencode/admin-totp.json`
  (session-local, dev only); production enrolment is unchanged.
- Known cosmetic gap: `favicon.ico` 404 in the console (Phase 9 polish).

## Commits (phase execution)

26 commits from `5b340d0` (tax engine) through `7f4f582` (route flattening); three are
defect fixes found by continuous verification (`fa04824`, `f01bcb7`, `7f4f582`).
