---
phase: 02-catalog-pricing
plan: 04
wave: 2
title: Products module APIs — products, barcodes, prices, search
requirements: [CAT-04, CAT-05, CAT-06, CAT-08]
depends_on: [01, 02]
status: planned
created: 2026-10-18
---

# Plan 04 — Products Module APIs

**Goal:** Products with barcodes, base prices, and branch overrides are created, edited,
searched, and archived through audited endpoints with branch-aware price preview.

## Task 1 — Products module scaffold and validation

**Files:** `api/src/modules/products/products.routes.ts`, `products.validation.ts`,
`products.controller.ts`, `products.service.ts`, `products.repository.ts`,
`products.types.ts` (schema from Plan 02)

- Zod schemas:
  - create: `sku?` (2–32, `[A-Za-z0-9-]`, uppercased), `name` 2–120, `description?` ≤ 500,
    `categoryId` uuid, `brandId` uuid nullish, `uomId` uuid,
    `costPriceMinor` non-negative safe int (admin-only — ignored/rejected for managers),
    `basePriceMinor` non-negative safe int, `taxCategory` enum default `STANDARD`,
    `barcodes?: string[]` (each 6–64, `[A-Za-z0-9-]`, max 10).
  - update: any of the above except `sku`? — **SKU editable** per D7; allow `sku` change
    with uniqueness 409.
  - list query: `q?` (1–120), `categoryId?` (uuid; includes subcategories),
    `brandId?` (uuid), `includeArchived` boolean default false, `branchId?` (uuid; admin
    only — managers are forced to their own branch), `limit`/`offset` (defaults 50/0,
    max 200).
- Routes wired in `api/src/app.ts`.

**Verify:** `bun run --filter api check-types`.
**Commit:** `feat(api): scaffold products module with validation`

## Task 2 — SKU suggestion and product create

**Files:** products module files

- `GET /api/products/suggest-sku` (admin; `catalog.create`) — peeks the next
  `catalog.skuSequence` value (`{ sku }`), does not consume it.
- `POST /api/products` (admin) — when `sku` is omitted, allocate atomically via
  `allocateFromSequence('catalog.skuSequence')` (`GIK-00001` style, zero-padded to 5);
  validate referenced category/brand/uom exist and are active (409 otherwise); normalize
  and dedupe barcodes, insert with product in one transaction; unique SKU/barcode
  violations → 409 with clear messages; audit `product.created` with the full snapshot.

**Verify:** integration tests: create with and without SKU (sequence bump); suggest does
not consume; duplicate SKU 409; duplicate barcode 409; inactive category/brand/uom 409;
manager create → 403; audit row contains barcodes and prices.
**Commit:** `feat(api): add product creation with sku allocation and barcodes`

## Task 3 — Product update, archive, and barcode management

**Files:** products module files

- `PATCH /api/products/:id` (admin) — partial update of name, description, category,
  brand, uom, tax category, cost price, base price, SKU; validation as in create;
  audit `product.updated` with before/after of changed fields.
- `POST /api/products/:id/archive` / `/reactivate` (admin; `catalog.archive`).
- `POST /api/products/:id/barcodes` (admin) — add one code (unique 409);
  `DELETE /api/products/:id/barcodes/:barcodeId` (admin) — remove; a product keeps at
  least zero barcodes (deletion allowed); audit both.
- `GET /api/products/:id` — full product with barcodes, base price, and the caller's
  visible overrides (see Task 4).

**Verify:** integration tests: update round trip with audit diff; SKU change conflict
409; archive/reactivate; barcode add/remove + duplicates; manager update → 403.
**Commit:** `feat(api): add product update, archive, and barcode endpoints`

## Task 4 — Branch price overrides

**Files:** products module files

- `PUT /api/products/:id/prices` (admin any branch; manager own branch via
  `branchScope`/`assertBranchAccess`; `price.override`) — upsert
  `{ branchId, priceMinor }`; branch must exist and be active (409); audit
  `product.price.override_set` with before/after.
- `DELETE /api/products/:id/prices/:branchId` — remove an override (manager own branch
  only); audit.
- `GET /api/products/:id/prices` — `{ basePriceMinor, overrides }`; managers see only
  their branch's override; admins see all.
- Base price and cost price changes stay in `PATCH /api/products/:id` (`price.update`
  permission is the same admin gate as `catalog.update`; document that).

**Verify:** integration tests: manager sets own branch override (200) and another branch
(403); admin sets any; delete override; effective price resolution matches shared
`resolveEffectivePrice`; audit rows for set/delete.
**Commit:** `feat(api): add branch price override endpoints`

## Task 5 — Search and list with branch-aware pricing

**Files:** products module files

- `GET /api/products` — filters per Task 1; `q` matches: barcode equality (any barcode),
  SKU prefix (`ILIKE 'q%'`), or name substring (`ILIKE '%q%'`, trigram index); results
  ordered by name; each row includes `basePriceMinor`, `effectivePriceMinor` (resolved
  against the branch in scope: admin `branchId` param or manager's own branch; null when
  no branch in scope), `barcodeCount`, category/brand/uom names (joined), `isActive`.
- Response `{ products, total, branchId }` with `limit`/`offset`.
- Include archived only when `includeArchived=true`.

**Verify:** integration tests: search by name substring, SKU prefix, and exact barcode;
category filter includes subcategories; effective price differs with an override;
manager list is scoped to their branch's overrides; pagination totals.
**Commit:** `feat(api): add product search with branch-aware pricing`

## Done When

Admins manage products, barcodes, and prices; managers read and set their own branch's
override; search finds products by name, SKU, and barcode with correct effective prices;
every mutation is audited; tests prove permissions and guards.
