---
phase: 08-admin-modules-shell
plan: 10
wave: 10
title: Suppliers module — master, payment details, supplied products
requirements: [UIX-06]
depends_on: [09]
status: planned
created: 2026-10-24
---

# Plan 10 — `modules/suppliers`

**Goal:** The supplier master becomes a module. Because payables migrate next, this plan leaves
every supplier→payables reference as a legacy import with a named TODO, and Plan 11 flips them.
That is deliberate: doing both in one plan would make a 9-route, 19-component commit
unreviewable.

Route lines: `suppliers/route.tsx` 52, `suppliers/index.tsx` 12, `suppliers/$supplierId.tsx` 111.

## Task 1 — API, keys, types

**Files:** new `admin/src/modules/suppliers/{api,types,utils}`; `lib/api.ts`; `lib/api-types.ts`

- `api/keys.ts`: `supplierKeys` with `suppliers`, `supplier`, `supplier-products`,
  `supplier-payments` (measured roots; keep the exact strings).
- `api/suppliers.ts` takes the `api.suppliers` group verbatim (lines 502–553 of `lib/api.ts`),
  including payment-detail reads/writes, supplied products, archive/reactivate, and the last-cost
  figure.
- `types/`: `Supplier`, `SupplierListRow`, `SupplierStatus`, `SupplierCreateInput`,
  `SupplierUpdateInput`, `SupplierListQuery`, `SupplierProduct`, `SupplierProductInput`,
  `PaymentDetail`, `PaymentDetailInput`, `PaymentDetailUpdateInput`.
- `utils/`: the supplier status/tone mapping and any bank/account display masking currently
  inline. **Payment details are sensitive**: an account number must render masked exactly as it
  does today, and must never be logged or put in a key.

**Verify:** `grep -rn "api.suppliers" admin/src` returns nothing; supplier search, create, edit,
archive, and reactivate work; payment details still mask the account.

**Commit:** `refactor(admin): add the suppliers module api and types`

## Task 2 — The section, list, and detail screens

**Files:** `modules/suppliers/pages/{suppliers-layout,suppliers-page,supplier-detail-page}.tsx`,
`modules/suppliers/components/{supplier-list,supplier-form-dialog,supplier-lifecycle-dialogs,supplier-overview,payment-details-panel,supplier-product-dialog,supplier-products-panel}.tsx`
(moved from `components/suppliers/`), `routes/_authenticated/suppliers/{route,index,$supplierId}.tsx`,
`index.ts`

- `suppliers/route.tsx` (52 lines) becomes `pages/suppliers-layout.tsx` — Plan 05's pattern. Its
  tabs include the payables screens that have not migrated yet; the layout is **suppliers**' page
  even though two of its tabs are payables' (research F8), and its tab list must not change.
- `pages/suppliers-page.tsx` wraps the already-extracted `supplier-list` component (the route was
  only 12 lines — prove it stays trivial).
- `pages/supplier-detail-page.tsx` from `$supplierId.tsx` (111 lines), composing
  `supplier-overview`, `payment-details-panel`, and `supplier-products-panel`.
- `supplier-product-dialog` imports the **common** product picker (Plan 02) — no inventory import.
- `supplier-combobox` is gone from this folder (moved to `common` in Plan 02); the files that
  still import `#/components/suppliers/supplier-combobox` must all have been updated then. Prove
  it with a grep before deleting the folder.
- Preserve: create is manager-allowed (`supplier.create`), archive guards, supplied-product last
  cost display, and the payment-details update audit trail.

**Verify:** create a supplier, edit payment details (masked on save and re-read), add a supplied
product, archive, reactivate; the supplier tabs still route to invoices/payments/aging (those
pages are still legacy — they must not break).

**Commit:** `refactor(admin): move the supplier screens into the suppliers module`

## Task 3 — Clear the name, keep the payables edge visible

**Files:** `scripts/check-modules.mjs` (**controller-owned**), `admin/biome.json`,
`admin/src/components/suppliers/` (deleted)

- Remove `suppliers` from `PENDING_MODULES`; add `#/components/suppliers/**` to the legacy group.
- Leave the remaining `#/components/payables/…` imports in the supplier pages with
  `TODO(phase-8/11)` comments naming Plan 11. Count them and record the number in the commit
  body — Plan 11 must reach zero.

**Verify:** `grep -rn "#/components/payables" admin/src | wc -l` returns the recorded count;
`bun run modules:check` passes with twelve modules migrated; `bun run lint`,
`bun run check-types`, `bun run --filter admin build` green; append to `evidence/suites.txt`.

**Commit:** `chore(admin): record suppliers as migrated`

## Definition of Done

- Supplier master, payment details, and supplied products live in one module with a barrel.
- Account numbers remain masked on screen, absent from logs, and absent from query keys.
- The supplier section's layout is a page, not a route, and its tabs still reach the payables
  screens.
- Every remaining cross-module import is a counted, TODO-annotated edge into `payables`.
