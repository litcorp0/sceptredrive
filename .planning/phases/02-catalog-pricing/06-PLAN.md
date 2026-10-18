---
phase: 02-catalog-pricing
plan: 06
wave: 4
title: Phase 2 verification and state update
requirements: [CAT-01..08, ADM-03]
depends_on: [05]
status: planned
created: 2026-10-18
---

# Plan 06 — Phase 2 Verification

**Goal:** All five Phase 2 success criteria are proven against a fresh database, with
evidence recorded, before Phase 3 starts.

## Task 1 — Fresh-database end-to-end verification

**Files:** verification script (throwaway, like Phase 1's `phase-verify.mjs`),
`.planning/phases/02-catalog-pricing/01-VERIFICATION.md`

- Recreate the dev database, migrate, `db:seed`, `db:seed --demo`; run API + console.
- Prove the roadmap success criteria:
  1. Admin creates a category (with child), brand, unit, product, barcode, and price
     (including the SKU suggestion path and a manual SKU).
  2. Duplicate barcode and duplicate SKU are rejected with 409 and clear messages.
  3. Manager sets a price override for their own branch (200) and is rejected for
     another branch (403); the effective price reflects the override in list responses.
  4. Tax: the shared engine's GRA example and the residual invariant are covered by unit
     tests; the console tax preview matches the stored breakdown for a demo product.
  5. Product search finds by name substring, SKU prefix, and exact barcode; pagination
     and active/archived toggles behave.
- Also verify: archive guards (category with active children/products, brand/unit in
  use), audit rows for every catalog mutation (create/update/archive/override),
  `lint`, `check-types`, `test`, `build` all pass, and console screens render for both
  admin and manager sessions (SSR checks like Phase 1).
- Record evidence (commands, outputs, known values) in `01-VERIFICATION.md`; list
  deviations and any human verification items (e.g. visual pass over the product editor).

**Verify:** a human can reproduce each criterion from the recorded runbook.
**Commit:** `docs(planning): verify phase 2 catalog and pricing`

## Task 2 — State and roadmap update

**Files:** `.planning/STATE.md`, `.planning/ROADMAP.md`

- Mark Phase 2 complete in the progress table and tick the roadmap section with the
  verification link.
- Add decisions taken during execution (if any) to the decisions log; update session
  notes (new modules, sequence helper, trigram index, console catalog patterns).
- Carry forward open items (no git remote, human verification list, Phase 3 readiness).

**Verify:** STATE reflects reality; the next action points at Phase 3 planning.
**Commit:** `docs(planning): update state for phase 2`

## Done When

All five Phase 2 success criteria are proven with recorded evidence; the state documents
point at Phase 3 (Inventory & Transfers).
