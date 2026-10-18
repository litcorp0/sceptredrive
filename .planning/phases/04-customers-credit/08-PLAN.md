---
phase: 04-customers-credit
plan: 08
wave: 7
title: Phase 4 verification and state update
requirements: [CUS-01..06, LOY-01..06, ADM-05]
depends_on: [06, 07]
status: planned
created: 2026-10-18
---

# Plan 08 — Phase 4 Verification

**Goal:** All five Phase 4 success criteria are proven against a fresh database with
recorded evidence — including ledger invariants, FEFO consumption, the expiry job, and
branch scoping — before Phase 5 starts.

## Task 1 — Fresh-database end-to-end verification

**Files:** walkthrough + browser scripts under
`.planning/phases/04-customers-credit/evidence/` (same pattern as Phase 3),
`.planning/phases/04-customers-credit/01-VERIFICATION.md`

- Recreate the dev database (volume reset as in Phase 3) → migrate → `db:seed` →
  `db:seed --demo`; run API (`:4000`) and console (`:3000`). Re-run the browser TOTP
  bootstrap if needed (`/tmp/opencode/admin-totp.json`).
- API walkthrough (`walkthrough-phase4.mjs`, HTTP + direct SQL assertions) proves the
  roadmap criteria:
  1. **Global identity, branch credit:** create a customer at ACC-SPX as the branch
     manager; a second manager (created temporarily for the warehouse branch) finds the
     same customer by phone suffix and name fragment but sees no credit profile;
     ACC-SPX owns the limit and balance.
  2. **Credit ledger + enforcement:** set limit/terms; post an opening charge; an
     over-limit charge is 409; the same charge with a `credit.override` reason posts and
     records the override; `due_date` equals charge date + terms.
  3. **Repayment + statement + aging:** a repayment allocates a `REP-…` number and
     reduces the balance; FIFO settlement SQL assertion matches per-charge outstanding;
     statement opening + entries = closing = `balance_minor`; aging buckets at an as-of
     date match hand-computed expectations; an overpayment leaves a negative (credit)
     balance; a refund reduces principal.
  4. **Loyalty earn/redeem/adjust/expire:** earn creates a lot; redeem consumes the
     earliest-expiry lot first (assert consumption rows); adjust posts with a reason;
     clawback past available points leaves a flagged negative balance; SQL-shift a lot's
     `expires_at` into the past, POST `/api/loyalty/expiry-run` → EXPIRE entry, lot
     zeroed, liability reduced; a second run changes nothing; liability = outstanding
     points × rate.
  5. **Scoping:** manager cannot read or post the other branch's credit (403); admin
     aging shows both branches separately. Plus: permission matrix spot checks
     (archive/anonymize/loyalty.settings admin-only, cashier denied), idempotent replay
     creates no second entry, reconciliation functions (credit sums, loyalty account and
     lots) return clean, audit rows exist for every mutation, anonymize blocked with a
     balance and completed at zero with ledgers intact.
- Browser walkthroughs (Playwright, `channel: "chromium"`, `SHOTS_DIR=evidence/`):
  create customer, phone-suffix search, credit panel + settings dialog, repayment toast
  with the REP number, over-limit charge override flow, statement page print view,
  aging buckets, loyalty adjust and history, liability report cards — screenshots kept
  in `evidence/`.
- Quality gates: `bun run lint`, `bun run check-types`, `bun run test` (after
  `db:test:prepare`), `bun run build`. Record commands, outputs, known values,
  deviations, and human-only items in `01-VERIFICATION.md` (criteria 1–5 mapping with
  PASS/FAIL and evidence paths).

**Verify:** a human can reproduce each criterion from the recorded runbook; every
reconciliation assertion prints zero discrepancies; the roadmap’s five criteria each
map to at least one recorded script assertion or screenshot.
**Commit:** `docs(planning): verify phase 4 customers credit and loyalty` (scripts,
screenshots, and the verification document together, as in Phase 3)

## Task 2 — State and roadmap update

**Files:** `.planning/STATE.md`, `.planning/ROADMAP.md`

- Mark Phase 4 complete in the progress table; tick the roadmap section with the
  verification link; add a Phase 4 additions summary (modules, tables, endpoints,
  console screens, jobs, evidence paths).
- Decisions log: payment terms semantics, derived FIFO settlement, overpayment credit
  (no netting), override mechanics, lot FEFO + clawback shortfall, expiry job with
  `missed: 'once'`, DPA archive/anonymize rules, pg-boss introduction.
- Session notes: ledger invariants and reconciliation functions, Phase 6 sync contract
  (`credit_profile.branch_id`, `customer.created_branch_id`, entry references for
  offline history), Phase 7 repayment/Paystack flows, Phase 8 exports and negative
  balance queue.
- Carry forward open items and set the next action to Phase 5 planning (Suppliers &
  Payables), which links supplier invoices to the Phase 3 receipts.

**Verify:** STATE reflects reality; the next action points at Phase 5.
**Commit:** `docs(planning): update state for phase 4`

## Done When

All five Phase 4 success criteria are proven with recorded evidence (API + SQL +
browser + screenshots); every reconciliation assertion is clean; and the state documents
point at Phase 5.
