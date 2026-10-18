---
phase: 04-customers-credit
plan: 03
wave: 3
title: Credit module — profiles, ledger, enforcement, repayments, aging, statements
requirements: [CUS-02, CUS-03, CUS-04, CUS-05, CUS-06]
depends_on: [01, 02]
status: planned
created: 2026-10-18
---

# Plan 03 — Credit Module

**Goal:** Branch-local credit as an append-only ledger with enforcement: limits, holds,
and terms per customer+branch; reason-coded overrides; repayments with sequenced
references; oldest-first settlement; aging and printable statements that reconcile to
the ledger exactly.

## Task 1 — Ledger engine, profiles, and FIFO settlement

**Files:** `api/src/modules/credit/credit.types.ts`,
`api/src/modules/credit/credit.validation.ts`,
`api/src/modules/credit/credit.repository.ts`,
`api/src/modules/credit/credit.service.ts`, `api/src/modules/credit/credit.test.ts`

- Repository: `lockOrCreateProfile(executor, customerId, branchId)` —
  `INSERT … ON CONFLICT DO NOTHING` then `SELECT … FOR UPDATE` (Phase 3 D16 pattern);
  `insertEntry`, `listEntries(filters)`, `sumForCustomerBranch` (used by reconciliation
  tests), `updateProfileSettings` (limit/hold/terms/notes only — never balance),
  `listProfilesByCustomer`, `listProfilesByBranch` (for aging).
- Service — one write path `postEntry(input)` used by every kind:
  1. Load customer (must exist; archived blocks CHARGE only), assert branch access,
     lock-or-create the profile.
  2. Validate kind-specific rules: CHARGE positive with reason (`SALE`,
     `OPENING_BALANCE`, `CORRECTION`, `OTHER`); REPAYMENT negative with method
     (`CASH`/`MOMO`/`BANK`) — allocates `REP-00001` through
     `allocateFromSequence('credit.repaymentSequence', executor)`; REFUND negative with
     `RETURN`; ADJUSTMENT signed non-zero with `CORRECTION`/`WRITE_OFF`/`DISPUTE`/
     `OTHER`. Reason required where the enum says so; amount never 0.
  3. Enforcement for CHARGE: `hold` → 409; `balance + amount > limit` → 409 unless
     `override.reasonCode` provided with `credit.override` permission — records
     `overrideReason`/`overriddenBy` on the entry. Overrides apply to one entry.
  4. Idempotency: a replay of the same `(branchId, idempotencyKey)` returns the existing
     entry (pre-check, plus unique-violation catch inside the transaction).
  5. New `balanceMinor = balance + amount` written to the profile in the same
     transaction; `dueDate = occurredAt date + paymentTermDays` on charges; audit entry
     per posting (`credit.charge`, `credit.repayment`, `credit.refund`,
     `credit.adjustment`, `credit.override` when applied).
- Settlement helper `settleCharges(entries)` — pure function: apply negative entries
  (REPAYMENT/REFUND/negative ADJUSTMENT) oldest-first to charges in `occurredAt` order,
  returning per-charge `outstandingMinor` plus unapplied overpayment. Used by aging and
  statements; unit-testable. `updateProfile(input)` (settings only) is a separate,
  audited path (`credit.profile_updated`).

**Verify:** tests: sign/amount/reason validation matrix; hold blocks; at-limit passes;
over-limit 409 without override, succeeds with override and records who/why; archived
customer blocks charge; idempotent replay returns the same entry (no second row, no
balance change); FIFO settlement example (charge 100, charge 60, repay 120 → first
fully settled, second 40 outstanding); `balance_minor = SUM(amount_minor)` after a
mixed sequence; `REP-00001` allocated; replay/concurrency: two parallel refunds below
balance both post and serialize.
**Commit:** `feat(api): add credit ledger engine, profiles, and settlement`

## Task 2 — Credit API: profiles, entries, repayments, override

**Files:** `api/src/modules/credit/credit.routes.ts`,
`api/src/modules/credit/credit.controller.ts`, `api/src/app.ts`,
`api/src/modules/credit/credit.test.ts`

- Routes (session + permission): `GET /api/credit/profiles?customerId=&branchId=`
  (`credit.read`; managers forced to their branch via `resolveBranchFilter`),
  `PUT /api/credit/profiles/:customerId` (`credit.profile.manage`; body: limit, hold,
  termDays, notes; managers only their branch), `POST /api/credit/repayments`
  (`credit.repayment` — REPAYMENT entries), `POST /api/credit/entries`
  (`credit.adjust` — CHARGE/REFUND/ADJUSTMENT; the service re-checks `credit.override`
  with the session user, fail closed, when an override is supplied), `GET
  /api/credit/entries?customerId&branchId&from&to&page` (`credit.read`, branch-scoped).
  Two posting routes keep kind-dependent permission enforcement at the middleware
  layer where possible.
- Wire `creditRoutes` into `app.ts`. Controllers pass validated input straight to the
  service; no logic in controllers.

**Verify:** HTTP tests: manager posts a repayment at their branch → 201 with `REP-…`
reference; manager attempting another branch → 403; cashier → 403; PUT profile as
manager updates limit/terms and audit exists; over-limit charge without
`credit.override` → 409, with it → 201 and `overrideReason` set.
**Commit:** `feat(api): add credit entries, repayments, and override API`

## Task 3 — Aging and statements

**Files:** `api/src/modules/credit/credit.service.ts`,
`api/src/modules/credit/credit.routes.ts`,
`api/src/modules/credit/credit.controller.ts`, `api/src/modules/credit/credit.test.ts`

- `getAging(user, branchFilter, asOf)` — for every customer with a profile at the
  branch and non-zero outstanding: per-charge outstanding from `settleCharges`, buckets
  Current / 1–30 / 31–60 / 61–90 / 90+ **days past due** (negative days = Current),
  customer totals and branch totals. Manager sees only their branch; admin any/all.
- `getStatement(user, customerId, branchId, from, to)` — opening balance (sum before
  `from`), ranged entries with kind/reference/`dueDate`/signed amount/note, closing
  balance, and the aging snapshot as of `to`. Assert branch access. 404 when the profile
  does not exist.
- Routes: `GET /api/credit/aging?branchId&asOf` (`credit.read`),
  `GET /api/credit/statements/:customerId?branchId&from&to` (`credit.read`); both
  branch-scoped. Statement is data-only; printing is the console's concern (Plan 06).

**Verify:** aging test with three charges across dates and terms (30/0 days) asserts
bucket membership and totals; statement with entries before/inside the range asserts
opening/closing; statement reconciles: opening + ranged sum = closing =
`balance_minor`; manager querying another branch's aging gets their own scope; admin
sees all branches separately.
**Commit:** `feat(api): add credit aging and statements`

## Done When

Credit at branch A is fully owed, enforced, collected, and reported without touching
branch B: signed append-only entries with reasons and references, balance always equal
to the entry sum, over-limit blocked unless a manager override is recorded, repayments
settling oldest charges first, and aging and statement numbers that reconcile to the
ledger.
