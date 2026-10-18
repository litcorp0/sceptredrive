---
phase: 04-customers-credit
plan: 04
wave: 3
title: Loyalty module — account, ledger, lots, FEFO, expiry engine
requirements: [LOY-01, LOY-02, LOY-03, LOY-04, LOY-06]
depends_on: [01, 02]
status: planned
created: 2026-10-18
---

# Plan 04 — Loyalty Module

**Goal:** One global points balance per customer: every earn creates a lot with an
expiry date, redemption and clawback consume lots earliest-expiry-first, adjustments are
reason-coded, and the balance always reconciles to the append-only ledger.

## Task 1 — Ledger/lot engine and expiry service

**Files:** `api/src/modules/loyalty/loyalty.types.ts`,
`api/src/modules/loyalty/loyalty.validation.ts`,
`api/src/modules/loyalty/loyalty.repository.ts`,
`api/src/modules/loyalty/loyalty.service.ts`, `api/src/modules/loyalty/loyalty.test.ts`

- Repository: `lockOrCreateAccount(executor, customerId)` (guarantee + `FOR UPDATE`);
  `insertEntry`, `insertLot`, `appendConsumption`, `lockLotsFefo(accountId)` — live lots
  (`remaining_points > 0`) ordered `(expiresAt, earnEntryId)` with `FOR UPDATE`;
  `updateAccountBalance`, `updateLotRemaining`, `listLots`, `listEntries`,
  `sumEntriesForAccount` (reconciliation tests), `insertAccountForCustomer` (bootstrap
  helper used by the customers module).
- Service — single write path `postEntry(input)`:
  - EARN: positive points; `points = floor(netPaidMinor × earnPointsPerCedi / 100)`
    computed by `earnPointsForSale(netPaidMinor)` (settings read once per call); creates
    the entry and a lot with `expiresAt = addMonths(occurredAt, loyalty.expiryMonths)`.
  - REDEEM: negative points; requires whole points ≥
    `loyalty.minimumRedeemPoints` and `balance ≥ points` (else 409); consumes lots FEFO
    via `lockLotsFefo`, writing one consumption row per lot; `quoteRedeem(points)`
    returns the discount value in pesewas (`floor(points × 100 / pointsPerCedi)`) for
    the POS/console to display.
  - CLAWBACK: negative points with reason `RETURN`; consumes lots FEFO **up to
    available**; any residual leaves the balance negative (flagged — Plan 07 surfaces
    it) with lots clamped at zero.
  - ADJUST: signed, reason required (`CORRECTION`/`GOODWILL`/`OTHER`); positive adjust
    also creates a lot so expiry stays total.
  - Locks the account row, writes balance projection in the same transaction,
    idempotency by `(branchId, idempotencyKey)`, audit per posting
    (`loyalty.earned`, `loyalty.redeemed`, `loyalty.clawback`, `loyalty.adjusted`).
- `expireDueLots(now = new Date())` — in one transaction per account: find live lots
  with `expiresAt ≤ now`, write one EXPIRE entry per account (sum, `branchId: null`,
  `createdBy: null`) plus consumption rows per lot, update balance/lots, audit
  `loyalty.expiry_run` with the summary `{ accounts, lots, points }`. Idempotent:
  a second run finds nothing due. This function is the seam the jobs plan (05) calls.

**Verify:** tests: earn math `floor` (GHS 10.75 → 10 pts at rate 1); lot created with
correct `expiresAt`; redeem below minimum → 409; redeem above balance → 409; redeem
consumes earliest-expiry lot first and writes consumption rows; clawback past available
→ negative balance with zero-remaining lots; adjustment reasons enforced; idempotent
replay; reconciliation `SUM(points_delta) = balance` and (normal cases)
`SUM(lot.remaining) = balance`; `expireDueLots` twice — first expires, second no-ops.
**Commit:** `feat(api): add loyalty engine with lots, FEFO, and expiry`

## Task 2 — Loyalty routes: account, entries, liability

**Files:** `api/src/modules/loyalty/loyalty.routes.ts`,
`api/src/modules/loyalty/loyalty.controller.ts`, `api/src/app.ts`,
`api/src/modules/loyalty/loyalty.test.ts`

- Routes (session + permission): `GET /api/loyalty/accounts/:customerId`
  (`loyalty.read`) — account summary, lots (points/remaining/expiry), recent entries;
  global read (loyalty is one balance across branches), entries carry their branch for
  display. `POST /api/loyalty/entries` (`loyalty.adjust`) — kinds EARN, REDEEM,
  CLAWBACK, ADJUST with reason codes, idempotency key, and optional reference; this is
  the staff path Phase 6/7 POS flows reuse through their own endpoints. `GET
  /api/loyalty/liability?from&to` (`loyalty.read`) — outstanding points and their GHS
  value at the current redemption rate, activity totals per branch
  (earned/redeemed/clawed back/adjusted/expired) for the range, and the list of
  negative balances (manager: own-branch activity only; admin: all).
- Wire `loyaltyRoutes` into `app.ts`.

**Verify:** HTTP tests: earn via route, redeem with quote check, liability maths
(250 points → GHS 2.50 at 100 pts/GHS 1) and per-branch activity; manager sees
own-branch activity and all-branch balance; cashier → 403.
**Commit:** `feat(api): add loyalty routes and liability report`

## Task 3 — Loyalty test hardening and reconciliation endpoints

**Files:** `api/src/modules/loyalty/loyalty.test.ts`,
`api/src/modules/loyalty/loyalty.service.ts`

- Add the reconciliation function `reconcileAccounts()` — compares each account balance
  to its ledger sum and lot remainders, returning divergences (no writes); used by tests
  and the Phase 8 reports. Cover the full journey in one test: earn → redeem → clawback
  shortfall → adjust → expire, asserting balance, lots, and consumption at each step.

**Verify:** journey test green; reconciliation returns empty after the journey;
`bun run --filter api check-types`.
**Commit:** `test(api): cover loyalty reconciliation and full journey`

## Done When

Points are earned with lots and expiry dates, redeemed FEFO with per-lot consumption,
clawed back proportionally (negative balances flagged), adjusted only with reasons, and
expired by an idempotent function — and the global balance reconciles to the ledger at
every step.
