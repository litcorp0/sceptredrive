---
phase: 02-catalog-pricing
plan: 05
wave: 3
title: Console catalog screens and settings extensions
requirements: [ADM-03, CAT-08]
depends_on: [03, 04]
status: planned
created: 2026-10-18
---

# Plan 05 — Console Catalog Screens

**Goal:** Admins manage the whole catalog from the console; managers browse it, see
branch-aware prices, and edit their own branch's override; tax preview uses the shared
engine.

## Task 1 — API client types and catalog API functions

**Files:** `admin/src/lib/api-types.ts`, `admin/src/lib/api.ts`

- Types: `Category` (with `children`), `Brand`, `Uom`, `Product` (joined names,
  `basePriceMinor`, `effectivePriceMinor`, `barcodeCount`, `taxCategory`, `isActive`),
  `ProductDetail` (+ `barcodes`, `overrides`), `PriceOverride`, plus input types and list
  query types.
- `api.catalog` (categories/brands/units) and `api.products` (list/get/create/update/
  archive/reactivate/barcodes/overrides/suggestSku) functions mirroring the verified
  contracts.

**Verify:** `bun run --filter admin check-types`.
**Commit:** `feat(admin): add catalog api client types and functions`

## Task 2 — Navigation and catalog layout

**Files:** `admin/src/components/layout/sidebar.tsx`,
`admin/src/routes/_authenticated/catalog/route.tsx` (layout with tabs)

- Sidebar item "Catalog" (`catalog.read`) placed after Dashboard.
- `/catalog` layout: page header + tabs (Products, Categories, Brands, Units) using the
  existing `Tabs` component; `/catalog` redirects to `/catalog/products`.

**Verify:** renders; manager sees Catalog; cashier never reaches the console.
**Commit:** `feat(admin): add catalog navigation and tabbed layout`

## Task 3 — Categories, brands, and units screens

**Files:** `admin/src/routes/_authenticated/catalog/categories.tsx`, `brands.tsx`,
`units.tsx`, small shared dialogs under `admin/src/components/catalog/`

- Categories: two-level tree table (parent rows with indented children), create dialog
  (name + optional parent select limited to top-level categories), edit dialog, archive/
  reactivate with confirmation; server 409 guard messages surfaced verbatim (e.g. "has
  active children").
- Brands and units: tables with create/edit dialogs; archive/reactivate; duplicates show
  the 409 message.
- All mutations: toasts via `toastApiError`, query invalidation (`['categories']`,
  `['brands']`, `['uoms']`), admin-only actions hidden for managers via
  `hasPermission`.

**Verify:** manual + SSR render checks; admin creates a category tree and a brand;
archive guard message appears when archiving a used brand.
**Commit:** `feat(admin): add category, brand, and unit screens`

## Task 4 — Products list with branch-aware pricing

**Files:** `admin/src/routes/_authenticated/catalog/products.tsx`

- Filters: debounced search, category select (grouped parent/child), brand select,
  include-archived toggle; pagination via the shared `Pagination`.
- Columns: SKU (mono), name, category, brand, unit, base price, effective price (shown
  when the active branch context is a specific branch), status badge, actions
  (View/Edit, Archive).
- Prices formatted as GHS from integer pesewas (`formatGhs` helper in
  `admin/src/lib/format.ts`).
- Empty/loading/error states via existing table components.

**Verify:** list round trip against the API; manager sees effective prices for their
branch; search by barcode finds the product.
**Commit:** `feat(admin): add product list with branch-aware prices`

## Task 5 — Product create/edit page with tax preview and overrides

**Files:** `admin/src/routes/_authenticated/catalog/products.new.tsx`,
`products.$id.tsx`, `admin/src/components/catalog/product-form.tsx`,
`barcode-editor.tsx`, `price-overrides.tsx`, `tax-preview.tsx`,
`admin/src/lib/format.ts`

- Product form (shared by new/edit): SKU (suggest button + editable), name, description,
  category (grouped select), brand, unit, tax category select, cost price (admin only),
  base price; barcodes chip editor (add/remove, validation errors inline); save →
  create/update with toasts and 409 messages inline.
- Tax preview panel: `taxBreakdown(basePriceMinor, taxCategory, taxMode)` from
  `@gikautos/shared` rendered as base/VAT/NHIL/GETFund/total rows, labelled with the
  active tax mode; updates as the price changes; display-only note.
- Price overrides panel on the edit page: table of active branches with override inputs
  (admin: all; manager: own branch only), save per row (`PUT`), remove (`DELETE`);
  shows base vs effective.
- Archived products render read-only with a reactivate action.

**Verify:** create a product end to end from the console (SKU suggested, barcode added,
tax preview matches the API test values); edit price and confirm the list updates;
manager sets their branch override and sees it in the list.
**Commit:** `feat(admin): add product editor with tax preview and price overrides`

## Task 6 — Settings screen additions

**Files:** `admin/src/routes/_authenticated/settings.tsx`

- Add rows: `catalog.skuPrefix` (text), `catalog.skuSequence` (int, note that it affects
  new products only), `pricing.taxMode` (INCLUSIVE/EXCLUSIVE select — needs a select
  editor type added to `SETTING_META`).

**Verify:** change `pricing.taxMode` and confirm the product tax preview switches between
inclusive and exclusive.
**Commit:** `feat(admin): expose catalog settings in the console`

## Done When

An admin can build the whole catalog from the console with correct Ghana tax previews;
managers can browse with branch-aware prices and edit only their branch's override;
settings expose SKU and tax-mode configuration.
