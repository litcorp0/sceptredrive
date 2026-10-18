---
phase: 02-catalog-pricing
plan: 02
wave: 1
title: Catalog schema, migration, settings, and demo seed
requirements: [CAT-01..07]
depends_on: []
status: planned
created: 2026-10-18
---

# Plan 02 — Catalog Schema, Migration, Settings, Demo Seed

**Goal:** The catalog tables exist with correct constraints and indexes; new settings
(SKU sequence, tax mode) are defined; the demo seed produces a small, idempotent catalog.

## Task 1 — Catalog schema (masters)

**Files:** `api/src/modules/catalog/catalog.schema.ts`

- `category`: uuid PK, `name` (text, not null), `parent_id` self-FK (uuid, nullable,
  `onDelete: 'restrict'`), `isActive` boolean not null default true, `createdBy` text,
  created/updated timestamps. Indexes: unique on `lower(name)` (expression), index on
  `parent_id`, index on `is_active`.
- `brand`: uuid PK, `name`, `isActive`, `createdBy`, timestamps; unique on `lower(name)`.
- `uom`: uuid PK, `code` (unique, e.g. `PCS`), `name`, `isActive`, timestamps.

**Verify:** `bun run --filter api check-types`.
**Commit:** `feat(api): add catalog master schema`

## Task 2 — Products schema

**Files:** `api/src/modules/products/products.schema.ts`

- Enum `tax_category` = `STANDARD | ZERO_RATED | EXEMPT`.
- `product`: uuid PK, `sku` (unique, not null), `name` (not null), `description` text,
  `categoryId` FK → category (restrict, not null), `brandId` FK → brand (set null,
  nullable), `uomId` FK → uom (restrict, not null), `costPriceMinor` integer not null
  default 0 (admin-only), `basePriceMinor` integer not null, `taxCategory` enum not null
  default `STANDARD`, `isActive` boolean not null default true, `createdBy`, timestamps.
  Indexes: unique `sku`; GIN trigram on `name`; `category_id`; `brand_id`; `uom_id`;
  `is_active`.
- `barcode`: uuid PK, `productId` FK (cascade), `code` text not null (unique),
  `createdBy`, `createdAt`.
- `product_price`: uuid PK, `productId` FK (cascade), `branchId` FK → branch (restrict),
  `priceMinor` integer not null, `updatedBy`, timestamps; unique `(product_id, branch_id)`.

**Verify:** `bun run --filter api check-types`.
**Commit:** `feat(api): add product, barcode, and branch price schema`

## Task 3 — Migration with pg_trgm

**Files:** `api/migrations/0002_*.sql` (generated), drizzle journal

- `bun run db:generate`, then edit the generated SQL to prepend
  `CREATE EXTENSION IF NOT EXISTS pg_trgm;` (drizzle-kit does not emit it).
- Apply locally: `bun run db:migrate`; verify the trigram index exists
  (`\d+ product` shows the GIN index) and re-apply to `gikautos_test`
  (`bun run db:test:prepare`).

**Verify:** migration applies cleanly on a fresh database (drop/create `gikautos`,
migrate, check `pg_indexes` for the GIN index).
**Commit:** `feat(api): add catalog migration with trigram search index`

## Task 4 — Settings additions and sequence generalization

**Files:** `api/src/modules/platform/settings.validation.ts`,
`api/src/modules/platform/settings.service.ts`, `api/src/seed/demo.ts` (settings defaults)

- Add to `SETTING_DEFINITIONS`: `catalog.skuPrefix` (text, default `GIK`),
  `catalog.skuSequence` (positive int, default 1), `pricing.taxMode`
  (`z.enum(['INCLUSIVE','EXCLUSIVE'])`, default `INCLUSIVE`).
- Generalize the staff-ID allocator: extract
  `allocateFromSequence(key: 'staff.idSequence' | 'catalog.skuSequence')` in the settings
  service (same FOR UPDATE row lock + retry), reimplement `allocateStaffId` on top, and
  export the generic helper for the products module. Keep behavior identical (existing
  tests must stay green).

**Verify:** `bun run test` (settings/staff suites unchanged); `GET /api/settings`
resolves the three new keys.
**Commit:** `feat(api): add catalog settings and generalize sequence allocation`

## Task 5 — Demo seed catalog

**Files:** `api/src/seed/demo.ts`, `api/src/seed/helpers.ts`

- New idempotent helpers: `ensureUom`, `ensureBrand`, `ensureCategory`,
  `ensureProduct` (with optional barcodes and base price), following the existing
  ensure-* style.
- Demo data: units (PCS, SET, PAIR, BOX, LTR), brands (Bosch, Denso, NGK, Febi), two-level
  categories (Engine → Oil Filters/Air Filters/Belts; Brakes → Pads/Discs; Electrical →
  Batteries/Spark Plugs; Fluids → Engine Oil), ~12 products with unique barcodes (mix of
  EAN-13-style and supplier codes), sensible GHS prices in pesewas, one branch price
  override on `ACC-SPX`, and `catalog.skuSequence` bumped past the seeded SKUs.
- Re-running `bun run db:seed --demo` reports "already present" for everything.

**Verify:** seed twice; query counts (categories, products, barcodes) stay stable; no
duplicate SKU/barcode errors.
**Commit:** `feat(db): seed a demo catalog`

## Done When

A fresh database migrates to the catalog schema (with `pg_trgm`), all catalog settings
resolve, and `db:seed --demo` yields a browsable catalog idempotently.
