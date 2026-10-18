---
phase: 02-catalog-pricing
plan: 03
wave: 2
title: Catalog module APIs — categories, brands, units
requirements: [CAT-01, CAT-02, CAT-03]
depends_on: [02]
status: planned
created: 2026-10-18
---

# Plan 03 — Catalog Module APIs (Categories, Brands, Units)

**Goal:** Admin-only CRUD with archive guards for the three masters, permission-checked,
audited, and covered by integration tests.

## Task 1 — Permissions registry

**Files:** `packages/shared/src/permissions.ts`, `packages/shared/src/permissions.test.ts`

- Add: `catalog.read` (admin, manager), `catalog.create`/`catalog.update`/
  `catalog.archive` (admin only), `price.update` (admin), `price.override`
  (admin + manager).
- Extend the permission tests (manager has read + override only; cashier has none).

**Verify:** `bun run --filter @gikautos/shared test`.
**Commit:** `feat(shared): add catalog and price permissions`

## Task 2 — Catalog module scaffold (seven files)

**Files:** `api/src/modules/catalog/catalog.routes.ts`, `catalog.validation.ts`,
`catalog.controller.ts`, `catalog.service.ts`, `catalog.repository.ts`,
`catalog.types.ts` (schema already exists from Plan 02)

- Routes mounted in `api/src/app.ts` under `/api`.
- Zod schemas: category create (`name` 2–80, `parentId` uuid nullish), update
  (`name`/`parentId`/`isActive` optional, at least one), brand create/update, uom
  create/update (`code` `[A-Z0-9]{2,8}` uppercase-normalized, `name` 2–80).
- Validators composed via `api/src/http/validation.ts` helpers (existing pattern).

**Verify:** `bun run --filter api check-types`.
**Commit:** `feat(api): scaffold catalog module for categories, brands, and units`

## Task 3 — Category endpoints with depth and archive guards

**Files:** catalog module files

- `GET /api/categories?includeArchived=` — full tree (parents with children), manager and
  admin.
- `POST /api/categories` (admin) — creating a child requires the parent to be a
  top-level category (depth ≤ 2); duplicate name (case-insensitive) → 409.
- `PATCH /api/categories/:id` (admin) — rename and re-parent; re-parenting is rejected
  when the category has children (409) or when the target parent is itself a child
  (409); self-parent rejected.
- `POST /api/categories/:id/archive` (admin) — blocked with 409 when the category has
  active children or active products; `POST /api/categories/:id/reactivate`.
- Every mutation writes an audit row in the same transaction.

**Verify:** integration tests: tree listing; depth guard (child under child → 409);
duplicate name 409; archive guard with an active child and with an active product;
reactivate; manager POST → 403; audit rows for create/update/archive.
**Commit:** `feat(api): add category endpoints with hierarchy and archive guards`

## Task 4 — Brand and unit endpoints

**Files:** catalog module files

- Brands: `GET` list (includeArchived), `POST`, `PATCH` (rename), archive blocked when
  active products reference the brand (409), reactivate; duplicate name → 409.
- Units: same shape; `code` immutable after creation (document in the API), duplicate
  code → 409; archive blocked when active products reference the unit.
- Audit rows for every mutation.

**Verify:** integration tests mirroring the category suite (CRUD, duplicates, guards,
manager 403s, audit).
**Commit:** `feat(api): add brand and unit endpoints`

## Done When

Categories (two levels), brands, and units are fully manageable by admins through
permission-checked, audited endpoints; managers can read; guards prevent dangling
archives; tests prove all of it.
