---
phase: 05-suppliers-payables
plan: 04
wave: 4
title: Payments, allocations, voids, balances, aging, and reconciliation
requirements: [SUP-04, SUP-05]
depends_on: [01, 02, 03]
status: planned
created: 2026-10-19
---

# Plan 04 — Payments, Allocations, Balances, Aging

**Goal:** Supplier payments are recorded with explicit allocation to one or more
invoices (or an on-account remainder), voids release allocations and flip invoices back,
and supplier balances and payables aging reconcile to the invoice and payment rows.

## Task 1 — Payment creation with allocations

**Files:** `api/src/modules/payables/payables.service.ts`,
`api/src/modules/payables/payables.validation.ts`,
`api/src/modules/payables/payables.test.ts`

- `createPayment(user, actor, input)`:
  1. Branch = `input.branchId` or the manager's own branch; `assertBranchAccess`;
     active branch; `requireSupplier`.
  2. Method `CASH`|`BANK`|`MOMO`; `amountMinor` integer ≥ 1; `paidAt` required ISO
     timestamp (may be past-dated; never in the future beyond a small clock-skew
     tolerance, consistent with other money paths); optional `reference` (≤ 80),
     `note` (≤ 500), `paymentDetailId` (must belong to the supplier and be active when
     given).
  3. Allocations: 0–20 entries `{ invoiceId, amountMinor ≥ 1 }`, invoice ids unique.
     Σ allocations ≤ `amountMinor` (the remainder is the on-account figure, D7).
  4. Transaction: lock the supplier row `FOR UPDATE` → allocate `PAY-#####`
     (`payable.paymentSequence`) → lock the referenced invoices `FOR UPDATE` in `id`
     order → validate each invoice: exists, same supplier, status not VOID, branch
     scope (managers only their branch's invoices), `amountMinor ≤ outstanding` →
     insert the payment and one `APPLY` allocation per invoice →
     `amountPaidMinor += amount` and recompute status (`PAID` when fully settled,
     `PARTIAL` otherwise) → audit `supplier_payment.created` (method, amount,
     allocations, remainder) → return the payment detail.
  5. Idempotency: `(branchId, idempotencyKey)` pre-check + unique-violation replay
     (Phase 4 D23) returning `replayed: true`.
- Guardrails tested explicitly: allocation above the invoice outstanding → 409 naming
  the invoice and remaining amount; allocation to another supplier's invoice → 409;
  allocation to a VOID invoice → 409; manager allocating to another branch's invoice →
  403; duplicate invoice ids in one request → 400; Σ allocations > amount → 400.

**Verify:** tests cover every guard above plus the happy paths (single invoice full
payment → PAID, partial → PARTIAL, multi-invoice, unallocated remainder), and the
parallel race (two simultaneous payments on one invoice never over-allocate — the
second either applies the remainder or fails the guard).

**Commit:** `feat(api): add supplier payments and allocations`

## Task 2 — Payment void with release rows

**Files:** `api/src/modules/payables/payables.service.ts`,
`api/src/modules/payables/payables.types.ts`,
`api/src/modules/payables/payables.test.ts`

- `voidPayment(user, actor, id, reason)`: reason required
  (`DUPLICATE`|`ERROR`|`RETURNED`|`BANK_REVERSAL`|`OTHER`); lock the payment and its
  invoices (sorted); for each invoice with a positive net allocation from this payment,
  insert one `RELEASE` row equal and opposite (`reversesAllocationId` points at the
  APPLY row when unambiguous), decrement `amountPaidMinor`, recompute status
  (`OPEN`/`PARTIAL`/`PAID`); set payment `VOID` + reason + `voidedBy`/`voidedAt`;
  audit `supplier_payment.voided` with the released amounts. Re-voiding → 409. Release
  rows are never updated or deleted (D8).
- `getPayment(user, id)`: header + allocations (APPLY and RELEASE with running totals) +
  invoice references (`number`, `supplierInvoiceNumber`, `branchId`) — branch-scoped.
- `listPayments(user, query)`: filters supplier/method/status/date range/branch via
  `resolveBranchFilter`; rows carry allocated and unallocated amounts.
- Tests: void with partial allocation flips PARTIAL→OPEN and PAID→PARTIAL correctly;
  release rows signed and summing to zero per payment; re-void 409; voided payment no
  longer contributes its remainder to balances; cross-branch manager void → 403.

**Commit:** `feat(api): add supplier payment void and reads`

## Task 3 — Supplier balances and payables aging

**Files:** `api/src/modules/payables/payables.service.ts`,
`api/src/modules/payables/payables.repository.ts`,
`api/src/modules/payables/payables.test.ts`

- `listSupplierBalances(user, query)`: per supplier (and per branch for admins; the
  manager is fixed to their branch): `invoiceOutstandingMinor` (Σ non-VOID invoice
  outstanding), `onAccountMinor` (Σ non-VOID payment remainders), `owedMinor =
  invoiceOutstanding − onAccount`, `overdueMinor`, `invoiceCount`; sorted by owed desc.
- `getAging(user, { asOf?, branchId?, supplierId? })`: invoices with outstanding > 0,
  status OPEN/PARTIAL, grouped into Current (due ≥ as-of) / 1–30 / 31–60 / 61–90 / 90+
  (days past due = as-of − dueDate); returns per supplier rows plus branch totals; a
  separate `onAccount` list per supplier (never netted into buckets, D9); as-of date
  defaults to today. Admin may pass `branchId`; managers are branch-fixed; warehouses
  participate like retail branches.
- Pure helper `bucketPayableDaysPastDue(days)` exported for reuse and tests (mirrors the
  credit aging helper style).
- `reconcilePayables()` (read-only, `payables.service`): asserts for every invoice
  `amountPaidMinor = Σ signed allocations` and the status matches the derivation
  (VOID ⇒ net 0); and per supplier+branch the owed formula equals an independent SQL
  sum; returns `{ invoicesChecked, suppliersChecked }`, throws on mismatch. Tests and the
  Plan 07 walkthrough call it.
- Tests: aging buckets with a fixed as-of date (invoice due yesterday → 1–30 bucket,
  31 days past → 31–60, etc.); only outstanding invoices appear; on-account listed
  separately; balances after partial payments and voids; `reconcilePayables` green after
  a randomized fixture dance (invoices, multi-allocations, voids) and red when a row is
  falsified directly (guarded by a transaction rollback).

**Commit:** `feat(api): add payable balances, aging, and reconciliation`

## Task 4 — Routes, validation, and wiring

**Files:** `api/src/modules/payables/payables.routes.ts`,
`api/src/modules/payables/payables.validation.ts`,
`api/src/modules/payables/payables.controller.ts`, `api/src/app.ts`

- Routes: `GET /api/payables/payments` (`payable.read`),
  `POST /api/payables/payments` (`payable.payment`),
  `GET /api/payables/payments/:id` (`payable.read`),
  `POST /api/payables/payments/:id/void` (`payable.void`),
  `GET /api/payables/balances` (`payable.read`), `GET /api/payables/aging`
  (`payable.read`).
- Zod: strict bodies; allocations array ≤ 20; dates ISO; enums for method/reason;
  `asOf` ISO date; `pageSize` ≤ 100.
- Integration tests through `app.request()`: permission matrix, branch scoping
  (manager sees only own-branch rows in lists, balances, aging), 404s, validation 400s.

**Verify:** `bun run --filter api test`; `bun run --filter api check-types`;
`bun run lint`.
**Commit:** `feat(api): expose supplier payment and aging routes`

## Done When

Payments post once, allocate explicitly, and never over-apply an invoice under
concurrency; the on-account remainder is visible and counted against the supplier
balance; voids release allocations as compensating rows and flip invoices back; balances
and aging reconcile to the rows they claim to summarize, proven by `reconcilePayables()`
and tests.
