---
phase: 05-suppliers-payables
plan: 05
wave: 5
title: Console — suppliers section, payment details, supplied products
requirements: [SUP-01, SUP-02, ADM-06]
depends_on: [02]
status: planned
created: 2026-10-19
---

# Plan 05 — Console Suppliers

**Goal:** The admin console gains a Suppliers section: searchable supplier list with
create/edit, a supplier detail screen managing contact data, bank/MoMo payment details,
and supplied-product mappings with supplier SKUs and last costs, plus the settings group
for the new prefixes and sequences.

## Task 1 — API client and types

**Files:** `admin/src/lib/api-types.ts`, `admin/src/lib/api.ts`

- Add hand-maintained types mirroring the API: `Supplier`, `SupplierDetail`,
  `SupplierListQuery`, `SupplierCreateInput`, `SupplierUpdateInput`,
  `SupplierPaymentDetail`, `PaymentDetailInput`, `SupplierProductMapping`,
  `SupplierProductInput`, list results. Money stays integer minor units.
- Add `api.suppliers` with `list`, `get`, `create`, `update`, `archive`, `reactivate`,
  `addPaymentDetail`, `updatePaymentDetail`, `addProduct`, `updateProduct`,
  `removeProduct` — same shape as `api.customers` (path params encoded, typed
  responses, errors surfaced through the existing envelope handling).
- Settings: no new client calls — the generic settings screen keys off
  `ResolvedSetting`; add the six Phase 5 keys to the settings type union if one exists.

**Verify:** `bun run --filter admin check-types`.
**Commit:** `feat(admin): add supplier API client`

## Task 2 — Section shell, supplier list, create/edit

**Files:** `admin/src/components/layout/sidebar.tsx`,
`admin/src/routes/_authenticated/suppliers/route.tsx`,
`admin/src/routes/_authenticated/suppliers/index.tsx`,
`admin/src/components/suppliers/supplier-form-dialog.tsx`,
`admin/src/components/suppliers/supplier-list.tsx`

- Sidebar: `{ to: "/suppliers", label: "Suppliers", icon: Truck, permission:
  "supplier.read" }` between Inventory and Customers (ADM-01 keeps one active section).
- `suppliers/route.tsx`: page header + tabs **Suppliers / Invoices / Payments / Aging**
  (Tabs + Outlet, mirroring `inventory/route.tsx`); tab links are plain routes, invoices/
  payments/aging land in Plan 06 — this plan renders tabs with the Suppliers tab active
  and the other routes as placeholders that Plan 06 replaces (keep the placeholder
  files trivial so Plan 06 owns their content).
- `suppliers/index.tsx`: debounced search (name/code), active/archived toggle (admin),
  paginated table (code, name, contact, phone, terms, status badge), empty/loading/error
  states; `New supplier` button gated on `supplier.create`.
- `supplier-form-dialog.tsx`: create/edit form — name (required), contact name, phone
  (client hint `024…`/`+233…`, server normalizes), email, address, TIN, VAT number,
  payment terms (days), notes; 409/400 server messages surfaced inline;
  `supplier.update` gates edit.
- List rows link to the detail route; archived rows muted.

**Verify:** `bun run --filter admin check-types`, `bun run --filter admin build`; manual
browser pass (list, create, edit) against a running API.
**Commit:** `feat(admin): add suppliers list and form`

## Task 3 — Supplier detail: overview, payment details, supplied products

**Files:** `admin/src/routes/_authenticated/suppliers/$supplierId.tsx`,
`admin/src/components/suppliers/supplier-overview.tsx`,
`admin/src/components/suppliers/payment-details-panel.tsx`,
`admin/src/components/suppliers/payment-detail-dialog.tsx`,
`admin/src/components/suppliers/supplier-products-panel.tsx`,
`admin/src/components/suppliers/supplier-product-dialog.tsx`,
`admin/src/components/suppliers/supplier-lifecycle-dialogs.tsx`

- Detail header: code, name, status badge, terms; `Edit` (dialog reused), `Archive`
  (admin; confirmation dialog explaining the debt guard; server 409 message — "amount
  owed GHS …" — rendered readably) and `Reactivate` on archived suppliers.
- Overview card: contact fields, TIN/VAT, address, notes.
- Payment details panel: rows with method badge (BANK/MOMO), label, masked account
  (`•••• 1234`), bank/network, default and active badges; add/edit dialog with
  method-conditional fields (BANK: account name/number, bank name, bank code with a
  "Paystack GHIPSS code" hint; MOMO: network select MTN/VOD/ATL and phone); "Make
  default" and "Deactivate" actions gated on `supplier.update`; the payload from
  `api.suppliers.get` shows the full number on this screen (D16).
- Supplied products panel: table of mappings (product SKU/name, supplier SKU, lead time,
  last cost with `formatGhs` + last updated, preferred badge); add/edit dialog (product
  search reuse from `admin/src/components/inventory/product-picker.tsx`, supplier SKU,
  lead time, preferred toggle); remove with confirmation. gated on `supplier.update`.

**Verify:** check-types + build; manual browser pass including the 409 archive guard and
default-switch behavior.
**Commit:** `feat(admin): add supplier detail, payment details, and products`

## Task 4 — Settings group for suppliers and payables

**Files:** `admin/src/routes/_authenticated/settings.tsx`

- Add a "Suppliers & Payables" settings group (admin-only like other global groups):
  `supplier.codePrefix`, `payable.invoicePrefix`, `payable.paymentPrefix` (1–8
  alphanumeric) and the three sequences (positive integers) with the existing
  validation/error surfaces and helper text explaining that sequences advance only on
  creation and gaps are acceptable.
- Reuse the existing settings edit flow (`api.settings.update`), no new endpoints.

**Verify:** check-types + build; manual pass: change `payable.paymentPrefix` to `SPAY`,
record a seeded payment via the API, confirm `SPAY-#####`; restore.
**Commit:** `feat(admin): add supplier and payables settings group`

## Done When

An admin can create and maintain suppliers with bank/MoMo details and supplied-product
mappings; a manager can browse them; the archive guard explains itself; and the new
prefixes/sequences are editable in Settings — all with the dense ops styling and
permission-aware actions of the existing console.
