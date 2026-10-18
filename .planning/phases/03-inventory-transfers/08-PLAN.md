---
phase: 03-inventory-transfers
plan: 08
wave: 8
title: Phase 3 verification and state update
requirements: [INV-01..09, ADM-04]
depends_on: [06, 07]
status: planned
created: 2026-10-18
---

# Plan 08 — Phase 3 Verification

**Goal:** All six Phase 3 success criteria are proven against a fresh database with
recorded evidence, including the ledger invariant under real operations, before Phase 4
starts.

## Task 1 — Fresh-database end-to-end verification

**Files:** walkthrough scripts under `.planning/phases/03-inventory-transfers/evidence/`
(API script + Playwright browser script, following Phase 2's pattern),
`.planning/phases/03-inventory-transfers/01-VERIFICATION.md`

- Recreate the dev database (`db:down` → volume reset as in Phase 2) → migrate → `db:seed`
  → `db:seed --demo`; run API (`:4000`) and console (`:3000`).
- API walkthrough proves the roadmap criteria:
  1. **Invariant:** after a scripted mix (receipts, adjustments, dispatch, partial
     receives, short-close, count post), for every product/branch
     `SELECT quantity_on_hand FROM stock_level` equals
     `SELECT SUM(quantity_delta) FROM stock_movement` (direct SQL assertion in the
     script), and no API path updates/deletes a movement.
  2. **Receipt with supplier invoice:** raises on-hand, updates branch average cost
     (assert the exact blended integer), stores supplier name/invoice number, allocates
     GRN; no payable row exists (Phase 5 documented).
  3. **Adjustments:** 400 without a reason; audit row present with actor/branch/before/
     after; negative result 409.
  4. **Transfers:** dispatch deducts source; partial receive adds destination and leaves
     pending; short-close records shortfall with note; over-dispatch/over-receive 409;
     costs carried (destination average assertion).
  5. **Count:** snapshot equals levels; post writes variance movements; final level equals
     current-before-post + variance; negative-guard 409 path exercised.
  6. **Warehouse:** terminal creation on a warehouse 409; low-stock list returns exactly
     the rows at/below threshold.
- Also verify: product archive blocked with stock (409, allowed at zero), permission
  matrix spot checks (manager other branch 403 on stock/receipt/adjust/transfer/count),
  audit entries for every mutation, reconciliation helper returns clean.
- Browser walkthrough (Playwright, `channel: "chromium"`) covers the console flows:
  stock list/filter/detail/history, receive dialog (GRN toast), adjust dialog, threshold
  update → low-stock filter, transfer draft → dispatch → partial receive → complete (or
  short-close), count entry → post; screenshots kept in `evidence/`.
- Run `bun run lint`, `bun run check-types`, `bun run test` (after `db:test:prepare`),
  `bun run build`. Record commands, outputs, known values, deviations, and human-only
  items (visual pass) in `01-VERIFICATION.md`.

**Verify:** a human can reproduce each criterion from the recorded runbook; invariant
assertion output shows zero discrepancies.
**Commit:** `docs(planning): verify phase 3 inventory and transfers`

## Task 2 — State and roadmap update

**Files:** `.planning/STATE.md`, `.planning/ROADMAP.md`

- Mark Phase 3 complete in the progress table; tick the roadmap section with the
  verification link; add a Phase 3 additions summary (modules, tables, sequences,
  console screens, evidence paths).
- Decisions log: WAC formula and rounding, lock-or-create concurrency pattern, short-close
  no-movement rationale, transfer side authority, count snapshot semantics, archive and
  warehouse guards.
- Session notes: single-writer posting service, sorted lock order, Phase 5 receipt link,
  Phase 6 movement enum growth and oversell posting mode, movement `reference_number`
  for offline history.
- Carry forward open items (Phase 4 readiness: customers/credit/loyalty; GRA, Paystack,
  PowerSync, VPS, signing unchanged).

**Verify:** STATE reflects reality; next action points at Phase 4 planning.
**Commit:** `docs(planning): update state for phase 3`

## Done When

All six Phase 3 success criteria are proven with recorded evidence (API + browser +
invariant SQL assertions); the state documents point at Phase 4 (Customers, Credit &
Loyalty).
