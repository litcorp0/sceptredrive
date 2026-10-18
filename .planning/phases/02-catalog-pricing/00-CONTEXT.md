---
phase: 02-catalog-pricing
name: Catalog & Pricing
depends_on: [01-foundation]
requirements: [CAT-01..08, ADM-03]
status: planned
created: 2026-10-18
---

# Phase 2 — Catalog & Pricing — Locked Context

**Goal:** A fitment-free product catalog with SKUs, barcodes, categories, brands, units,
prices, and correct Ghana tax is fully managed in the admin console.

This document records the decisions taken with the operator before writing the plans.
It overrides convenience in any later plan.

## Locked Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Ghana tax (verified 2026-10-18) | VAT 15% + NHIL 2.5% + GETFund 2.5% = 20% **on one base** (VAT Act 2025, Act 1151, effective 2026-01-01; COVID-19 levy and flat-rate schemes abolished) | Current GRA law; matches the project's locked 20% decision |
| D2 | Tax categories | `STANDARD` (20%), `ZERO_RATED` (0%, relieved), `EXEMPT` (0%, exempt) | CAT-07; zero-rated and exempt behave the same at the till but differ in reporting later |
| D3 | Tax mode | Global setting `pricing.taxMode` = `INCLUSIVE` (default) or `EXCLUSIVE` | PROJECT.md assumption; one mode business-wide, never per product |
| D4 | Catalog write permissions | **Admin-only** creates/edits/archives for categories, brands, units, products, barcodes, base prices, and cost prices. Managers read everything and set price overrides for **their own branch only** | Operator decision; one source of truth, no duplicate products |
| D5 | Category depth | **Two levels** (category → subcategory); a subcategory cannot be a parent; depth enforced in the service | Operator decision; covers auto-parts grouping without tree complexity |
| D6 | Quantity model | **Integer quantities only** (whole units); no fractional stock or sales in v1 | Operator decision; exact integer math across stock, POS, and money |
| D7 | SKU generation | Auto-generated sequential `GIK-00001` (prefix + zero-padded sequence in settings), **editable** before save; suggestion does not consume the sequence; creation allocates atomically (gaps acceptable) | Operator decision; mirrors the staff-ID sequence pattern |
| D8 | Barcodes | One or more per product; any unique code 6–64 chars (letters, digits, `-`); no EAN check-digit enforcement; duplicates rejected with 409 | Operator decision; works with supplier labels and keyboard-wedge scanners |
| D9 | Cost price | Global per product; **admin-only** edits; Phase 5 supplier invoices will update it through audited service calls | Operator decision; consistent costing across branches |
| D10 | Prices | Integer minor units (pesewas). Base price on `product`; optional branch override in `product_price` (unique per product+branch). Price changes are mutable columns captured by audit before/after rows (not append-only ledgers) | CAT-06; audit log already proves history |
| D11 | Search | `pg_trgm` GIN index on product name (substring), exact/prefix indexes on SKU and barcode equality; active-only by default with an include-archived toggle | CAT-08; verified `pg_trgm` available in `postgres:18-alpine` |
| D12 | Tax engine location | Pure functions in `@gikautos/shared` (integer basis-point math), reused by the API, the console preview, and the offline POS in Phase 6 | Client-safe; offline POS must compute tax without the network |
| D13 | Archiving | Archive, never delete: masters and products have `isActive`; archiving a parent with active children/products is blocked (409) | Append-only spirit; referential integrity for history |
| D14 | Demo seed | `db:seed --demo` gains a small catalog (units, brands, two-level categories, ~12 products with barcodes and prices) — idempotent | Phase 1 D16 deferred this to Phase 2 |
| D15 | Rounding | Integer math only. Inclusive: `base = round(total × 10000 / 12000)`, each component `round(base × bp / 10000)`, any residual added to VAT so `base + VAT + NHIL + GETFund === total` exactly. Exclusive: components computed on the exact base, total is their sum | No floats, no off-by-one; invariant is unit-tested |
| D16 | New permissions | `catalog.read` (admin+manager), `catalog.create`/`catalog.update`/`catalog.archive` (admin), `price.update` (admin; base + cost), `price.override` (manager+admin; own branch for managers) | D4; extends the shared permission registry |
| D17 | Module layout | Two API modules following the seven-file layout: `catalog` (categories, brands, units) and `products` (products, barcodes, prices) | Keeps files small; matches AGENTS.md |

## Architectural Invariants (do not violate)

- **Server is authoritative.** Prices, tax, and permissions are decided in the API; the
  console's tax preview is display-only.
- **Integer money.** All amounts are integer minor units (pesewas). The tax engine
  rejects non-integer or negative inputs.
- **Append-only audit.** Every catalog mutation writes an audit row in the same
  transaction (before/after), exactly like Phase 1.
- **No secrets, no PII.** Catalog data is not personal data; nothing new to protect.
- **Fail closed.** Authorization denies on error; unique violations return 409 with a
  clear message.

## Verified Research (see 01-RESEARCH.md)

- GRA VAT reforms (Act 1151, effective 2026-01-01): 15% VAT + 2.5% NHIL + 2.5% GETFund
  on the same base; COVID-19 levy abolished; flat-rate schemes removed; registration
  threshold GHS 750k (context only). GRA worked example: 1,000 → NHIL 25, GETFund 25,
  VAT 150, total 1,200.
- `pg_trgm` extension verified available and creatable in `postgres:18-alpine`.
- Drizzle 0.45.4 supports `.using('gin', sql\`...\`)` indexes and partial unique
  indexes (already used by `setting`).

## Bootstrap Order

1. Shared tax engine + pricing helpers with exhaustive tests (Plan 01).
2. Catalog schema, migration (with `pg_trgm`), settings additions, demo seed (Plan 02).
3. Catalog module APIs: categories, brands, units (Plan 03).
4. Products module APIs: products, barcodes, prices, search (Plan 04).
5. Console catalog screens + settings extensions (Plan 05).
6. Phase verification (Plan 06).

## Open Items (carry into later phases)

- Supplier invoices (Phase 5) will update cost prices through audited service calls.
- Receipts (Phase 6) snapshot line prices and tax at sale time.
- E-VAT invoice fields (Phase 8) build on the tax breakdown shape defined here.
- Fractional quantities are out of scope for v1 (D6); revisit only with a real need.
