---
phase: 08-admin-modules-shell
plan: 13
wave: 13
title: Section walkthrough, phase verification, and state update
requirements: [UIX-06, UIX-07]
depends_on: [12]
status: planned
created: 2026-10-24
---

# Plan 13 — Section Walkthrough and Phase Verification

**Goal:** Prove the phase goal backwards. The admin has no unit-test suite, so "no behaviour
change" has to be demonstrated by walking every screen in a real browser and by a static gate
that fails when the architecture is crossed.

## Task 1 — Promote the section-coverage walkthrough

**Files:** `admin/test/walkthrough-sections.mjs` (new), `admin/test/run-walkthrough.sh` (new),
`admin/package.json`

- Add `playwright@1.64.1` as an admin devDependency (§F7: it is currently declared only in
  `desktop/` and the Phase 7 scripts at the repo root work by accident of hoisting).
- Add `"test:walkthrough": "node test/walkthrough-sections.mjs"`. **Do not** name it `test`: root
  `bun run test` runs every workspace's `test` script via `--if-present`, and a walkthrough that
  needs a live API and a seeded database must not join that suite.
- `run-walkthrough.sh` follows the Phase 7 runner: boot `bun run --filter admin dev` on port
  3001 with a trap, wait for `/login`, then run the script with `ADMIN_URL` set. It requires the
  API on `:4000` and `bun run db:seed --demo`.
- Reuse the Phase 7 sign-in helper (TOTP bootstrap from `/tmp/opencode/admin-totp.json`,
  credentials from the seed).

**Verify:** `bash admin/test/run-walkthrough.sh` starts, signs in as admin, and reports the
section count before any assertion is added.

**Commit:** `test(admin): add a section-coverage walkthrough harness`

## Task 2 — Walk every section as an admin

**Files:** `admin/test/walkthrough-sections.mjs`

For each route below, assert: HTTP 200, the expected landmark element present, at least one data
row where the demo seed guarantees one, zero console errors, and zero failed API requests.
Screenshot each section into `.planning/phases/08-admin-modules-shell/evidence/shots/`.

| # | Route | Landmark | Data guaranteed by the seed |
|---|---|---|---|
| 1 | `/` | dashboard heading | summary tiles |
| 2 | `/branches` | branch table | ACC-SPX, ACC-WH1 |
| 3 | `/branches/$id` | branch detail | the same branch |
| 4 | `/terminals` | terminal table | `ACC-SPX-T01` |
| 5 | `/staff` | staff table | admin + manager + cashier |
| 6 | `/catalog/products` | product table | 12 products |
| 7 | `/catalog/products/$id` | product editor | `GIK-00001` |
| 8 | `/catalog/products/new` | create form | — (form only) |
| 9 | `/catalog/categories` | category table | seeded categories |
| 10 | `/catalog/brands` | brand table | seeded brands |
| 11 | `/catalog/units` | unit table | seeded units |
| 12 | `/inventory/stock` | stock table | opening stock at ACC-SPX |
| 13 | `/inventory/stock/$productId` | movement history | opening receipt movement |
| 14 | `/inventory/receipts` | receipt table | `GRN-00001`, `GRN-00002` |
| 15 | `/inventory/receipts/$id` | receipt detail | linked invoice badge |
| 16 | `/inventory/transfers` | transfer table | — (empty state must render) |
| 17 | `/inventory/transfers/new` | transfer form | — |
| 18 | `/inventory/counts` | count table | — (empty state) |
| 19 | `/inventory/counts/new` | count form | — |
| 20 | `/customers` | customer table | Akosua, Kwame, Efua |
| 21 | `/customers/$id` | profile + credit + loyalty tabs | Akosua's balance |
| 22 | `/customers/$id/statement` | statement view | Akosua's ledger |
| 23 | `/customers/aging` | aging table | Akosua outstanding |
| 24 | `/loyalty` | liability report | Kwame's 250 points |
| 25 | `/suppliers` | supplier table | Sceptre Drive Imports |
| 26 | `/suppliers/$id` | supplier detail | payment details + products |
| 27 | `/suppliers/invoices` | invoice table | — (empty state) |
| 28 | `/suppliers/invoices/new` | invoice form | — |
| 29 | `/suppliers/payments` | payment table | — (empty state) |
| 30 | `/suppliers/aging` | payables aging | — (empty state) |
| 31 | `/audit` | audit table | seeded audit rows |
| 32 | `/settings` | settings groups | resolved settings |

- "Empty state" is itself the assertion for screens the seed leaves empty: the shared
  `EmptyState`/`TableMessage` must render, and the page must not show an error or a spinner
  that never resolves. That is the regression this phase is most likely to cause.
- Assert **no console error contains `Cannot read` / `undefined is not`** — a barrel that
  re-exports a component into a cycle fails exactly this way (research F2/F4).

**Verify:** the script reports a single pass count over 32 sections plus the per-section
assertions; screenshots exist for all 32; re-running it twice in a row passes (no state
dependency).

**Commit:** `test(admin): walk all 32 console sections after the module migration`

## Task 3 — Walk the role boundary as a manager

**Files:** `admin/test/walkthrough-sections.mjs` (second browser context)

- Sign in as the demo manager (`ACC-SPX`) and assert:
  - the branch switcher is a locked badge with no `Select` and no "All branches" option;
  - `/` , `/inventory/stock`, `/customers`, `/customers/aging`, `/suppliers`, `/audit` load;
  - `/staff` lists only ACC-SPX staff;
  - appending `?branchId=<ACC-WH1 id>` to `/customers/aging` does **not** render ACC-WH1 rows;
  - a nav item the manager's role cannot see is absent, and typing its URL returns the
    permission error rather than a blank shell (the API is the enforcement; the shell is
    cosmetic).
- Also sign in as the cashier and assert the console refuses them entirely (cashiers use the
  POS).

**Verify:** the manager and cashier legs are recorded in the same run report; the branch-lock
screenshots are captured.

**Commit:** `test(admin): prove the manager branch lock and role boundary`

## Task 4 — Run the full gate matrix

**Files:** `.planning/phases/08-admin-modules-shell/evidence/suites.txt` (new, **controller-owned**)

Run and record, in this order, with the numbers:

1. `bun run lint` — clean (note any pre-existing warnings and their count, as Phase 7 did).
2. `bun run modules:check` — pass with `PENDING_MODULES` empty; include the module table.
3. `bun run brand:check` and `bun run tokens:check` — pass.
4. `bun run check-types` — 6/6.
5. `bun run test` — API **360**, shared **96**, desktop **339**, unchanged from baseline (D10:
   nothing outside `admin/` was touched, so any drift is a defect in this phase).
6. `bun run --filter admin build` — production build OK; confirm `dev-charts` still 404s.
7. `bun run --filter admin check-types` — clean.
8. `bash admin/test/run-walkthrough.sh` — 32 sections + 3 role legs.
9. `node .planning/phases/08-admin-modules-shell/evidence/verify-module-gate.mjs` — 11/11.
10. The Phase 7 shell capture re-run — 16/16.

- Also record the **before/after line counts**: `admin/src/routes` total, the largest route file,
  `lib/api.ts`, `lib/api-types.ts`. The phase's claim is structural, and the numbers are its
  cheapest evidence.

**Verify:** `suites.txt` contains every command and its exact result; no suite was edited to pass.

**Commit:** `docs(phase-8): record the verification suite run`

## Task 5 — Write the verification report

**Files:** `.planning/phases/08-admin-modules-shell/01-VERIFICATION.md` (new, **controller-owned**)

Map each roadmap success criterion to its proof:

| Criterion | Proof |
|---|---|
| 1. `modules/` holds every domain with the seven folders | `modules:check` table + `ls admin/src/modules` |
| 2. Every route file is a thin route | the gate's route rule + the largest-route number in `suites.txt` |
| 3. No module reaches into another's internals; Biome fails otherwise | `verify-module-gate.mjs` mutations 3 and 4 |
| 4. The shell is role-aware on all four clauses | Task 3 legs + Plan 12's audit table + Phase 7 capture 16/16 |
| 5. No behaviour change | the 32-section walkthrough, the manager/cashier legs, and unchanged API/shared/desktop suites |

Then record: deviations (the D8 re-ordering from research §7, the pre-existing lack of an admin
test suite, the deliberate exception of `dev-charts.tsx`), any defect found and fixed, and the
carry-forwards.

**Verify:** every criterion has a command or a named recorded step; the report names no criterion
as "expected to pass".

**Commit:** `docs(phase-8): verify the phase and record the evidence`

## Task 6 — Update project memory

**Files:** `.planning/STATE.md`, `.planning/ROADMAP.md` (**controller-owned**)

- `ROADMAP.md`: mark Phase 8 complete with the verification link; correct the stale "8,682 route
  lines" figure if it appears in a success criterion.
- `STATE.md`: progress row, the "Next action" line (→ Plan Phase 9), an execution-notes block in
  the established style (complete + commits, deviations, findings, suite numbers), and the
  carry-forwards: `dev-charts` deletion and `modules/analytics` in Phase 9, `modules/pos-oversight`
  in Phase 14, and any defect this phase deliberately did **not** fix.
- Note the D8 amendment (credit/loyalty before customers, suppliers before payables) in the
  phase's context or in STATE, so a later reader does not think the order was arbitrary.

**Verify:** STATE's progress table and the Next action agree; a fresh reader can find the plan
files, the verification report, and the evidence from the roadmap entry alone.

**Commit:** `docs(planning): complete phase 8 and point at phase 9`

## Definition of Done

- 32 sections walked in a real browser, plus three role legs, from one re-runnable command.
- `bun run modules:check` strict and clean; the mutation proof 11/11.
- Root suites unchanged: API 360, shared 96, desktop 339.
- `01-VERIFICATION.md` maps every roadmap criterion to evidence; STATE and ROADMAP updated.
- No behaviour change: the only intentional differences are file locations and import paths.
