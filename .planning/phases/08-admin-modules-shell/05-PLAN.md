---
phase: 08-admin-modules-shell
plan: 05
wave: 5
title: Catalog module — products, categories, brands, units
requirements: [UIX-06]
depends_on: [04]
status: planned
created: 2026-10-24
---

# Plan 05 — `modules/catalog`

**Goal:** The largest single-domain migration: seven routes (1,421 lines) and seven components,
plus the section layout pattern that the other tabbed sections will copy.

Catalog route lines: layout 50, index 7, products list 311, product detail 214, product new 110,
categories 202, brands 171, units 173.

## Task 1 — The section layout pattern

**Files:** `admin/src/modules/catalog/pages/catalog-layout.tsx` (new),
`admin/src/routes/_authenticated/catalog/route.tsx`

- Move the `PageHeader` + `Tabs` + `Outlet` body out of the route into
  `catalog-layout.tsx`, which renders the header and its own `<Outlet />`.
- The route becomes `createFileRoute("/_authenticated/catalog")({ component: CatalogLayout })`.
- This is the template for `customers`, `inventory`, and `suppliers`: **section layout markup is
  page markup**, so it lives in the owning module, and a route file never renders a `Tabs`.
- Keep the tab order and labels byte-identical — the sidebar's section label and the breadcrumb
  read from the same navigation table, and moving a tab here would change two things at once.

**Verify:** the four catalog tabs render and navigate; the breadcrumb still says "Catalog";
`catalog/route.tsx` is ≤ 25 lines.

**Commit:** `refactor(admin): give the catalog section a layout page`

## Task 2 — Catalog API and types

**Files:** new `admin/src/modules/catalog/{api,types}`; `lib/api.ts`; `lib/api-types.ts`

- `api/keys.ts`: `catalogKeys` covering `categories`, `categoryTree`, `brands`, `uoms`,
  `products`, `product` — the measured roots, spelled the same so the five current invalidation
  sites keep working.
- `api/catalog.ts` and `api/products.ts` take the `api.catalog` and `api.products` groups.
- `types/`: `Category`, `CategoryTreeNode`, `Brand`, `Uom`, `ProductRow`,
  `ProductWithBarcodes`, `ProductDetail`, `Product`, `Barcode`, `PriceOverride`, `TaxCategory`,
  `TaxMode`, the six create/update inputs, `CatalogListQuery`, `ProductListQuery`.
- `utils/`: if the page composes a display value (e.g. margin or stock chip tone), it moves here
  as a pure function; money stays integer minor units and formatting still comes from
  `#/lib/format` (`formatGhs`, `parseGhsToMinor`, `formatMinorPlain`).

**Verify:** `grep -rn "api.catalog\|api.products" admin/src` returns nothing; a product search
still hits the trigram endpoint with the same debounce; no float arithmetic appears in the
diff (`grep -n "toFixed\|parseFloat\|/ 100" ` on the moved files shows only the existing
`lib/format.ts` helpers).

**Commit:** `refactor(admin): add the catalog module api and types`

## Task 3 — Catalog pages and components

**Files:** `admin/src/modules/catalog/{pages,components,index.ts}`; the seven catalog routes;
`admin/src/components/catalog/**` (moved)

- `pages/`: `products-page`, `product-detail-page`, `product-new-page`, `categories-page`,
  `brands-page`, `units-page`.
- `components/`: `product-form`, `barcode-editor`, `price-overrides`, `tax-preview`,
  `category-dialog`, `brand-dialog`, `unit-dialog` — moved verbatim from `components/catalog/`.
- `index.ts` exports six pages plus `CatalogLayout`.
- Preserve exactly: the live tax preview, the branch price-override panel and its permission
  gates, archive guards surfaced from the API (409s), barcode duplicate errors, and the
  `catalog/index.tsx` `beforeLoad` redirect (it stays on the route, D6).
- Product tiles/rows must keep using the shared `StatusBadge` and `TableMessage`; do not invent
  a catalog-local empty state.

**Verify:** create a product with two barcodes and a branch override, archive it (blocked while
stock exists, with the API's message), search by SKU/name/barcode, and open the tax preview at
GHS 100.00 inclusive — it must still show the 15 / 2.5 / 2.5 split. `bun run modules:check`
passes with seven modules migrated.

**Commit:** `refactor(admin): move the catalog screens into the catalog module`

## Task 4 — Clear the name

**Files:** `scripts/check-modules.mjs` (**controller-owned**), `admin/biome.json`,
`admin/src/components/catalog/` (deleted)

**Verify:** `bun run lint`, `bun run check-types`, `bun run --filter admin build`, root
`bun run test` unchanged; append to `evidence/suites.txt`.

**Commit:** `chore(admin): record catalog as migrated`

## Definition of Done

- Seven catalog routes are thin; the section layout is a page, not a route.
- 1,421 route lines and 7 components live in one module with one barrel.
- The tax preview and price-override permission gates behave identically.
- No money arithmetic was introduced, moved, or reformatted.
