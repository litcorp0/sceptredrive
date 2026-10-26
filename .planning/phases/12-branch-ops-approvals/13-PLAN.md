---
phase: 12-branch-ops-approvals
plan: 13
title: Verification, evidence, state update
lane: verification
depends_on: [12]
requirements: [APR-01, APR-02, APR-03, APR-04, APR-05, APR-06, BRN-01, BRN-02, BRN-03, BRN-04, BRN-05, CC-01, CC-02, CC-03, CC-04, CC-05]
---

# Plan 13 — Prove the phase, then record it

## Goal

Every roadmap criterion and every requirement maps to a command, a numbered leg or a screenshot;
the POS is proven untouched; six mutations prove the gates can fail; and `.planning/STATE.md` says
what was decided and what was not.

## Read first

- `.planning/phases/11-procurement-replenishment/11-VERIFICATION.md` — the shape to follow.
- `.planning/phases/11-procurement-replenishment/evidence/` — `run-suites.sh`,
  `walkthrough-procurement.mjs`, `suites.txt`, `walkthrough-console.txt`, `shots/`.
- `admin/test/walkthrough-sections.mjs:133-165,173-232` — the sections table and `visit()`.
- `AGENTS.md` — the non-negotiables this phase must not break.

## Tasks

### 1. Gate transcript

`evidence/run-suites.sh` (copy Phase 11's, add the new suites):

```bash
bun run lint
bun run check-types
bun run --filter @sceptre/shared test
bun run --filter api test
bun run --filter desktop test
bun run modules:check
bun run modules:check:strict
bun run brand:check
bun run tokens:check
```

Run it once with every lane idle, tee to `evidence/suites.txt`, and end with `ALL SUITES PASSED`.
Expected counts: shared **~225**, API **~630** (479 + ~150), desktop **421** (unchanged),
`modules:check:strict` **19/19** admin and **14/14** POS, brand gate over the new file count.

### 2. API walkthrough — `evidence/walkthrough-branch-ops.mjs`

`fetch` + `pg`, no browser, fixtures created through the API, `PASS n` / `FAIL n`, exit non-zero on
a failure. Legs:

| # | Leg | Asserts |
|---|---|---|
| 1 | sign in as admin and as a branch manager | sessions, branch scope |
| 2 | manager raises a transfer request (branch→branch) | `REQUESTED`, approval `PENDING`, `deciderRole = MANAGER`, `amountMinor` hand-computed |
| 3 | dispatch before approval | 409, source level unchanged |
| 4 | source manager approves; dispatch; receive | `APPROVED` → `DISPATCHED` → `RECEIVED`; Σ movements = on-hand |
| 5 | second request, source manager rejects | `REJECTED`; **zero** movements for that transfer id |
| 6 | manager withdraws a pending request | `CANCELLED` + approval `WITHDRAWN` |
| 7 | warehouse→branch request | `deciderRole = ADMIN`; manager decide → 403; admin decide → 200 |
| 8 | write-off create → approve | value equals Σ qty × avg cost; movements of type `WRITE_OFF`; level drops; Σ movements = on-hand |
| 9 | write-off create → reject | status `REJECTED`, zero movements, level unchanged |
| 10 | write-off that would go negative | 409, still `PENDING_APPROVAL` |
| 11 | manager direct `DAMAGE` adjustment | 400; admin same call → 200 |
| 12 | price inside band (exactly 10%) | `APPLIED`, price row changed, audit `via: 'BAND'` |
| 13 | price one pesewa beyond | `PENDING_APPROVAL`, price row unchanged |
| 14 | approve price; approve again | row = proposed once; second → 409 |
| 15 | price moved underneath a pending request | approve → 409, row unchanged |
| 16 | remove an out-of-band override | request, not a delete |
| 17 | credit decrease direct | limit falls, audit `via: 'DIRECT_DECREASE'` |
| 18 | credit increase direct | 403, zero approvals |
| 19 | credit request → approve | limit only after approval; ledger count unchanged; balance unchanged |
| 20 | over-limit list vs analytics count | same total, same rows |
| 21 | shift close under tolerance | `review_status = NONE`, zero approvals |
| 22 | shift close one pesewa over tolerance | `REQUIRED`, one approval, `amountMinor = |variance|` |
| 23 | closer decides own variance | 403; manager (other) decides → `REVIEWED`; money columns byte-identical |
| 24 | count schedule create + run job twice | one count, `next_due_at` advanced once, zero-level product present |
| 25 | post count with a variance over tolerance | one `TRIGGER` count; second scan creates none |
| 26 | two oversell conflicts → trigger scan | one `TRIGGER` count; a third scan creates none |
| 27 | ABC recompute + manual override + clear | A/B/C by hand-computed shares; manual survives; cleared is overwritten |
| 28 | accuracy | matched/counted = expected bp; variance value = Σ `COUNT_VARIANCE`; `null` with no counts |
| 29 | inbox | `sort=oldest` ascending; `entityId` filter; summary counts equal the lists' totals |
| 30 | OWASP A01 matrix | per type: requester cannot decide own request; every new `/:id` route 403s a foreign branch; a smuggled `branchId` in a body is refused or ignored, never honoured |
| 31 | audit | every decision has an `approval.decided` row naming actor, reason and before/after; every effect has its own action row |
| 32 | POS untouched | `git diff --stat <phase-start>..HEAD -- desktop/ powersync/` empty; desktop suite 421 |

Re-derive three numbers from SQL rather than from the API response (the Phase 11 rule): the
write-off value, the transfer source level, and the accuracy basis points.

### 3. Console walkthrough

Extend `admin/test/walkthrough-sections.mjs`:

- `SECTIONS` gains `/approvals` ("Approvals"), `/operations` ("Branch operations"),
  `/inventory/write-offs` ("Write-offs"), `/customers/over-limit` ("Over limit").
- a **manager leg**: raises a transfer request, sees it in `/approvals` as requester and cannot
  decide it; raises a price change and sees the band sentence; requests a credit increase and sees
  the reason field; is refused the direct increase; sees the write-off form.
- an **admin leg**: decides one of each type from `/approvals`; sees the badge count fall; sees the
  variance review's single action.
- the accuracy card renders a percentage or "—", never "NaN".
- screenshots into `evidence/shots/` for every new screen at 1440 px, and the inbox and both forms
  at 1024 × 768.

Record the transcript as `evidence/walkthrough-console.txt`; the previous close was **159/159**,
this one must be higher and exit 0.

### 4. Mutation proofs

Apply each, run the narrow suite, confirm a failure, revert, and record the output in
`evidence/mutations.txt`:

| # | Mutation | Must fail |
|---|---|---|
| 1 | `withinPriceBand` `<=` → `<` | the exactly-10% case |
| 2 | self-approval check removed from `canDecideApproval` | the requester-decides leg, for a manager and an admin |
| 3 | `canDecideApproval` drops the `deciderBranchId` comparison | a manager deciding another branch's row |
| 4 | `dispatchTransfer` accepts `REQUESTED` | leg 3 |
| 5 | the write-off `REJECTED` branch posts the movements | leg 9's zero-movement assertion |
| 6 | the stale-price guard removed | leg 15 |
| 7 | the manager shrinkage guard removed from `createAdjustment` | leg 11 |
| 8 | `shift` close uses `>=` tolerance | the exactly-at-tolerance case |

If a mutation fails nothing, that is a gap in the tests and is fixed in the plan's own commit, not
explained away (Phase 11's mutation 5 found exactly this).

### 5. Verification document

`12-VERIFICATION.md` (the phase's verification file is numbered by the phase, not the plan):

- the nine roadmap criteria, each mapped to a command, a leg or a screenshot;
- the sixteen requirements (APR-01…06, BRN-01…05, CC-01…05) in a table, each with its proof;
- the OWASP Top 10:2025 table for this phase: A01 (authority, IDOR, self-approval), A04 (no new
  secrets, no new crypto), A05 (Zod on every body, parameterised SQL through Drizzle), A09 (audit
  rows), A10 (fail-closed 403/409, no stack traces);
- every defect found during execution, with the commit that fixed it;
- the numbers: suites, walkthrough legs, console checks, bundle size if it moved, brand-gate file
  count;
- what is **not** proven, named: no email, no approval expiry, no shift list (Phase 14), no refund
  approval (Phase 13), and the write-off reason `CORRECTION` hole documented in Plan 05.

### 6. State

`.planning/STATE.md`:

- mark Phase 12 complete (13/13) with the commit list per plan;
- add a "Phase 12 planning notes (2026-10-26)" section: the five operator decisions, the seven
  context amendments, the plan count, the schema additions, the settings, and the carry-forwards
  (`REFUND` handler in Phase 13, shift oversight screens in Phase 14, approval expiry unscheduled);
- set the next action to **plan Phase 13 — POS Payments, Returns & Shifts**, and name the two
  carry-forwards that phase must pick up (the `REFUND` approval type, and
  `averageBasketMinor`'s negative-take question from Phase 10);
- update the progress table.

`ROADMAP.md`: Phase 12 status → complete with the verification path.

## Verification

```bash
bash .planning/phases/12-branch-ops-approvals/evidence/run-suites.sh
node .planning/phases/12-branch-ops-approvals/evidence/walkthrough-branch-ops.mjs
bun run --filter admin test:walkthrough
git diff --stat -- desktop/ powersync/
```

## Commits

1. `test(api): branch-ops walkthrough with ledger reconciliation`
2. `test(admin): approvals, operations and request screens in the walkthrough`
3. `test: mutation proofs for authority, band and tolerance`
4. `docs(planning): phase 12 verification and evidence`
5. `docs(planning): state and roadmap update`

## Done when

- Every requirement has a proof, and every proof is a command or a numbered leg.
- The POS diff is empty and the desktop suite is unchanged.
- Six of eight mutations were caught and the two that were not are fixed.
- A reader who was not in the session can tell what was decided, what was not, and where to look.
