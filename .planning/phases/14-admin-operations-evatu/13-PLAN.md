---
phase: 14-admin-operations-evatu
plan: 13
title: Verification, evidence, state update
lane: verification
depends_on: [08, 09, 10, 11, 12]
requirements: [ADM-07, ADM-08, RPT-04, RPT-05, RPT-06, PAY-04, PAY-05, PAY-06, EVAT-01, EVAT-02, EVAT-03]
---

# Plan 13 — Prove the phase, do not describe it

## Goal

Every roadmap success criterion, every requirement and the OWASP table map to a numbered
leg, a committed test or a grep. The three invariants the phase exists for are proven by
comparing bytes, not by reading code: a resolution and a certificate leave their document
untouched, a supplier is paid only when the provider said so, and every report reconciles
to its ledger.

## Read first

- `00-DECISIONS.md` in full, especially the thirteen resolved defects and the security
  table.
- `01-RESEARCH.md` §1.1 and the facts each plan cites.
- `.planning/phases/13-pos-payments-returns/13-VERIFICATION.md` — the shape this document
  copies: criterion → evidence, numbers, mutations, what could not be run and why.
- `.planning/phases/12-branch-ops-approvals/evidence/walkthrough-branch-ops.mjs` — the
  external walkthrough style: fixtures through the API, figures re-derived in SQL, PASS/
  FAIL/NOT-DRIVEN with a non-zero exit.
- `.planning/phases/13-pos-payments-returns/evidence/walkthrough-payments.mjs` — device
  enrolment → shift → sale → refund, which this plan reuses for its fixtures.
- `admin/test/walkthrough-sections.mjs` — the browser suite Plans 08–11 extended.

## Tasks

### 1. The criterion map — `14-VERIFICATION.md`

One row per item, each pointing at a leg, a test name or a command:

| Source | Items |
|---|---|
| ROADMAP Phase 14 | five success criteria |
| REQUIREMENTS | ADM-07, ADM-08, RPT-04, RPT-05, RPT-06, PAY-04, PAY-05, PAY-06, EVAT-01, EVAT-02, EVAT-03 |
| `00-DECISIONS.md` | the OWASP A01–A10 table and the seven "must not break" invariants |

A criterion with no evidence is either a missing test or a missing feature; both are
findings, and both are fixed in this plan or named in §6 as not done.

### 2. The external walkthrough — `evidence/walkthrough-ops.mjs`

Fixtures through the API (admin session → branch → terminal → enrolment → device session →
shift), never through SQL, except where the plan says a figure is re-derived. Legs:

1. enrol a terminal, open a shift, sell with three tenders (cash + MoMo + credit);
2. refund GH₵250 cash and GH₵100 MoMo against that sale;
3. raise and observe a `STOCK_OVERSELL` conflict by selling the last unit twice offline;
4. read the sale through `/api/pos/oversight/sales/:id` and assert the receipt copy's
   `Σ lines = total`, `Σ tenders − change = total`;
5. resolve the conflict, then re-read the sale, its lines, its tenders and the stock ledger
   and assert **every checksum is unchanged**;
6. read the shift's Z through the session route and compare every figure with a SQL
   recomputation from the shift's own rows, including `cash_refund_minor`;
7. run the stock report and compare `totals.valueMinor` with
   `SELECT SUM(quantity_on_hand * avg_cost_minor)`;
8. download the credit ageing CSV and assert its `TOTAL` row equals `/api/credit/aging`'s
   cross-foot, and that a manager's file has more than one data row;
9. create a supplier transfer against the mock, settle it through the mock hook, assert
   `Σ allocations ≤ amount`, the remainder is on account, and the supplier balance moved by
   exactly `amount`;
10. fail a second transfer and assert the balance is unchanged;
11. replay the settlement webhook body and assert one `payment_event` and one payment;
12. read the E-VAT submission, assert `CERTIFIED`, assert the sale's checksum is unchanged,
    and assert `qr_payload` is the mock's;
13. retry a refused submission and watch `attempts` rise and `next_attempt_at` move;
14. permission matrix: a manager gets 403 on `evat.retry`, on another branch's conflict, on
    another branch's receipt copy, and on all five exports for a foreign branch; a cashier
    gets 403 on every new route.

Legs that cannot be driven are `NOT-DRIVEN` with the reason and the test that carries the
proof — the Phase 13 convention. Expected candidates: the OTP finalisation (the mock's OTP
lever is test-only), the real Paystack client (no keys), and a GRA refusal (mock only).

### 3. The browser walkthrough — `evidence/walkthrough-console.txt`

Run `bun run --filter admin test:walkthrough` with `EVIDENCE_DIR` set to the evidence
folder. It covers the five `/pos` sections, the three report screens' print sheets, the
transfer dialog, the reconciliation, `/evat`, `/settings` key parity, `/staff/permissions`
and `/audit`. Record the screenshot list and the final PASS count.

### 4. Mutations — `evidence/mutations.sh`, `evidence/mutations.txt`

Twelve mutations, each applied to the working tree, the named test run, and the tree
restored. A mutation that survives is a test gap repaired in this plan:

| # | Mutation | Caught by |
|---|---|---|
| 1 | resolve a conflict without checking it is `OPEN` | the 409 test |
| 2 | `resolutionProblem` accepts `DISMISSED` with no note | the shared test and the route 400 |
| 3 | post the supplier payment at initiation instead of settlement | the failed-transfer test (zero payments) |
| 4 | mint the transfer reference with uppercase | the reference-alphabet test |
| 5 | ignore `EVAT_MAX_ATTEMPTS` | the ninth-attempt test |
| 6 | write `serial` onto `sale` | the byte-identical test |
| 7 | compute stock value with a float division | the projection parity test |
| 8 | build the manager export from `byBranch` | the export parity test |
| 9 | include `before`/`after` in the audit CSV | the no-PII test |
| 10 | drop `SALE` from the movement filter | the enum-parity test |
| 11 | omit the cash-refund line from the Z | the render test |
| 12 | drop an unknown setting key in the console | the walkthrough key-parity assertion |

### 5. The gate matrix — `evidence/suites.txt`

One transcript, ending `ALL SUITES PASSED`:

```bash
bun run check-types
bun run lint
bun run --filter '@sceptre/*' test        # shared, api, desktop
bun run build
bun run modules:check:strict              # 21/21 admin
bun run modules:check:pos:strict          # 16/16 POS
bun run brand:check
bun run test:counter                      # by hand, needs Electron + PowerSync
```

Plus the packaged suites the repository already has: packaged print and packaged shell
smoke. Record each suite's before/after count: shared **318 → ?**, API **710 → ?**, desktop
**593 → ?**, admin modules **19 → 21**, brand gate **1 112 → ?**.

Run `test:counter` even though it is not in the matrix, and record its two known risks: it
needs a second Electron suite, and the audit's own device can report `dead_letter` uploads
(Phase 13's 149/150). A result below 150/150 is evidence only if the delta is explained.

### 6. The cleanup diff — prove what the phase did not touch

```bash
git diff --stat <phase-start>..HEAD -- powersync/      # must be empty
git diff --stat <phase-start>..HEAD -- packages/brand/  # must be empty
grep -rn "evat" powersync/ sync-config.yaml             # zero
```

And the positive diff: `api/migrations/0016_enum_phase14.sql` must precede
`0017_phase14_schema.sql`, and a scratch database must migrate from zero.

### 7. §6 — what is not proven

Write the section even when it is short. Expected content: no live Paystack transfer, no
GRA response, no physical QR, approval expiry still unimplemented, the demo price
overrides, a browser walkthrough that cannot drive the OTP path, and any leg left
`NOT-DRIVEN`.

### 8. STATE.md and the roadmap

- `STATE.md`: the phase table row becomes ✅ Complete (13/13 plans, verified); a
  `### Phase 14 execution notes` section records commits, counts, defects found during
  execution, and the carry-forwards; `Next action` becomes Phase 15.
- `ROADMAP.md`: Phase 14 gains its `**Status:** ✅ Complete (verified …)` line and a pointer
  to the verification document.
- `REQUIREMENTS.md`: unchanged unless execution changed a requirement (Phase 13 corrected
  POS-15; this phase expects no correction).

## Verification

The verification document is the deliverable; this section lists the commands whose output
it cites.

```bash
bun run check-types && bun run lint && bun run --filter '@sceptre/*' test && bun run build
bun run modules:check:strict && bun run modules:check:pos:strict && bun run brand:check
bun .planning/phases/14-admin-operations-evatu/evidence/walkthrough-ops.mjs
bun run --filter admin test:walkthrough
bash .planning/phases/14-admin-operations-evatu/evidence/mutations.sh
```

## Commits

1. `test(phase-14): gates all green and the phase's counts`
2. `test(phase-14): the external walkthrough and the twelve mutation proofs`
3. `docs(phase-14): verification, what was proven and what was not`
4. `docs(phase-14): state and roadmap`

## Done when

- Every criterion has a leg, a test or a command — and the ones that do not are named.
- Twelve mutations were applied, twelve were caught, and the transcript is committed.
- `powersync/` and `packages/brand/` have an empty diff for the whole phase.
- The next session can start Phase 15 without re-reading this phase's code.
