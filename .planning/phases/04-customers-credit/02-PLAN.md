---
phase: 04-customers-credit
plan: 02
wave: 2
title: Customers module — identity, search, lifecycle
requirements: [CUS-01, ADM-05]
depends_on: [01]
status: planned
created: 2026-10-18
---

# Plan 02 — Customers Module

**Goal:** One customer identity: created at a branch with a normalized Ghana phone,
found by phone or name from anywhere, editable, archivable, and anonymizable under the
DPA rules — with every mutation audited.

## Task 1 — Types, validation, repository, and core service

**Files:** `api/src/modules/customers/customers.types.ts`,
`api/src/modules/customers/customers.validation.ts`,
`api/src/modules/customers/customers.repository.ts`,
`api/src/modules/customers/customers.service.ts`,
`api/src/modules/customers/customers.test.ts`

- Validation (Zod + existing `validateJson`/`validateQuery` helpers): name 1–120
  trimmed; phone string 6–20; email optional email ≤ 160; address optional ≤ 300;
  create schema strict; update schema same fields optional with at least one present;
  search query `q` ≥ 2 chars, `page` ≥ 1, `pageSize` 1–50 default 20,
  `includeArchived` boolean (admin only), optional `branchId` for the admin filter.
- Repository (Drizzle only): `insertCustomer` + insert the `loyalty_account` row from
  `loyalty.schema.ts` in the same transaction (schema import only — keeps the module
  dependency acyclic per D22), `findById` with `credit_profile` rows and
  `loyalty_account` joined (schema reads), `findByPhone`
  (non-anonymized), `search` — phone digit-suffix match OR name `ILIKE` (trigram GIN
  serves it), archived excluded unless `includeArchived`; ordered by name; count query;
  `updateCustomer`, `archiveCustomer`, `anonymizeCustomer` (the only updates; no
  deletes anywhere).
- Service: `createCustomer` — normalize phone via `normalizeGhanaPhone` (400 on
  invalid), duplicate check → 409 `ConflictError` including the existing customer id in
  the message payload; insert customer + loyalty account in one transaction; audit
  `customer.created`. `updateCustomer` — re-normalize phone when changed, duplicate
  check, audit `customer.updated` with before/after (no PII payloads beyond the fields
  already in the record; phone/name only inside `before`/`after`). `getCustomer` —
  returns the customer plus credit profiles scoped to the caller
  (`resolveBranchFilter`; managers see only their branch's profile) and the loyalty
  balance. `searchCustomers` — managers/any staff may search globally; anonymized rows
  never appear. All reads exclude anonymized PII fields (they are null by then).
- Register the module in `api/src/app.ts` later in Task 3; service is testable alone.

**Verify:** service tests: create normalizes `0241234567` → `+233241234567`; duplicate
phone → 409 with existing id; search finds by last-4 digits and by name fragment;
archived hidden from default search; update re-checks phone uniqueness; audit rows exist
for create/update; balance/exception shape of `getCustomer`.
**Commit:** `feat(api): add customers service, search, and repository`

## Task 2 — Archive, reactivate, and anonymize

**Files:** `api/src/modules/customers/customers.service.ts`,
`api/src/modules/customers/customers.repository.ts`,
`api/src/modules/customers/customers.test.ts`

- `archiveCustomer` (admin): sets `status = ARCHIVED`, audit `customer.archived` with
  reason note. The credit service (Plan 03) refuses new CHARGE entries for archived
  customers by checking `customer.status`; this plan’s tests cover the state change and
  Plan 03’s tests cover the enforcement.
- `reactivateCustomer` (admin): back to `ACTIVE`, audit.
- `anonymizeCustomer` (admin): guards — read `credit_profile.balance_minor` (any
  branch) and `loyalty_account.balance_points` directly from the sibling schemas in
  `customers.repository.ts` (read-only); any non-zero value → 409 listing the blocking
  branch balances. On success: name → `Anonymized customer`, phone/email/address → null,
  `anonymizedAt` now, status stays as-is; ledgers untouched; audit
  `customer.anonymized` (ids only, no PII).
  Requires the customer to be archived first? No — anonymize implies invisible; the
  record stays reachable by id for ledgers only.
- The partial unique index (`WHERE anonymized_at IS NULL`) lets the released phone be
  registered by a new customer — covered by a test.

**Verify:** anonymize blocked with a non-zero branch balance and with non-zero loyalty
points (409 each); after zeroing via entries (direct insert in test), anonymize scrubs
PII while ledger rows remain and the phone is re-registrable; audit rows exist; reviving
archived → ACTIVE works.
**Commit:** `feat(api): add customer archive and anonymization`

## Task 3 — Routes, controller, and app wiring

**Files:** `api/src/modules/customers/customers.routes.ts`,
`api/src/modules/customers/customers.controller.ts`, `api/src/app.ts`,
`api/src/modules/customers/customers.test.ts`

- Routes (all behind `requireSession`): `GET /api/customers` (`customer.read`),
  `POST /api/customers` (`customer.create`), `GET /api/customers/:id`
  (`customer.read`), `PATCH /api/customers/:id` (`customer.update`),
  `POST /api/customers/:id/archive` (`customer.archive`),
  `POST /api/customers/:id/reactivate` (`customer.archive`),
  `POST /api/customers/:id/anonymize` (`customer.anonymize`). Controllers only read
  valid input and call the service; wire `customersRoutes` into `app.ts`.
- HTTP-level tests (platform.test.ts helpers): cashier denied everywhere; manager can
  create/update/read/search but archive/anonymize → 403; admin succeeds; response
  shapes match the console needs (list + count; detail with credit profiles + loyalty
  summary).

**Verify:** `bun run --filter api test` green after `db:test:prepare`;
`bun run --filter api check-types`; manual curl smoke: create → search by partial
phone → detail.
**Commit:** `feat(api): add customers routes`

## Done When

A customer can be created at a branch with a valid unique Ghana phone, found by phone
suffix or name from any branch, edited, archived (blocking new credit), reactivated,
and anonymized (zero-balance guard) with the ledger history intact — all permission
gated and audited.
