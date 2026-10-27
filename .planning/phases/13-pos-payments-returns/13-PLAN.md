---
phase: 13-pos-payments-returns
plan: 13
title: Verification, evidence, state update
lane: verification
depends_on: [12]
requirements: [POS-10, POS-11, POS-12, POS-13, POS-15, POS-16, PAY-01, PAY-02, PAY-03, PAY-07]
---

# Plan 13 — Prove the drawer, the ledger and the card

## Goal

Every success criterion in the roadmap, every requirement in this phase, and every OWASP line in
P13-D39 is mapped to a command, a numbered walkthrough leg, a committed test or a screenshot. Then the
state file says what is true, including what is not.

## Read first

- `00-DECISIONS.md` P13-D39, P13-D40.
- `README.md` — "Verification philosophy".
- `.planning/phases/12-branch-ops-approvals/12-VERIFICATION.md` — the shape to follow.
- `.planning/phases/12-branch-ops-approvals/evidence/` — `run-suites.sh`, `walkthrough-branch-ops.mjs`,
  `mutations.sh` and the transcript files, which this plan copies and extends.

## Tasks

### 1. A fresh database, from zero

```bash
docker compose down -v && docker compose up -d
bun run db:migrate          # 14 migrations from zero, including the split enum file
bun run db:test:prepare
bun run db:seed --demo
bun run sync:init
bun run seed:demo-sales
```

The enum split is what this proves: `0013_enum_phase13.sql` must apply on an empty database and the
DDL file that uses its values must apply after it.

### 2. The gate matrix — `evidence/suites.txt`

One transcript, ending `ALL SUITES PASSED`, of:

```bash
bun run check-types
bun run lint
bun run --filter @sceptre/shared test
bun run --filter api test
bun run --filter desktop test
bun run --filter admin check-types && bun run --filter admin build
bun run modules:check:strict
bun run brand:check
bun run tokens:check
bun run test:counter
bun run test:print
bun run test:e2e
```

Record the start → end counts: shared 239 → ?, API 596 → ?, desktop 427 → ?, and the brand gate's
tracked-file count.

### 3. The API walkthrough — `evidence/walkthrough-payments.mjs`

Against a running API in `PAYSTACK_MODE=mock`, with fixtures created **through the API** (admin
session → branch → terminal → enrolment → device session) and assertions printed one per line. At
minimum:

| Leg | Assertion |
|---|---|
| 1–4 | enrolment, session, shift open, two products |
| 5 | `POST /api/pos/payments` → `PENDING`, `display_text` present, `expires_at` ≈ +180 s |
| 6 | the same `clientPaymentId` again → the **same** payment id, one mock charge |
| 7 | mock settle → `PAID` |
| 8 | upload `SALE` cash 40 + MoMo 60 → `APPLIED`; SQL: `Σ tenders − change = total`, 2 tenders |
| 9 | re-upload the same sale → `REPLAYED`, `sale` count unchanged |
| 10 | deliver the `charge.success` body twice → 200 twice, one `payment_event` |
| 11 | a body signed with the wrong key → 401, no `payment_event` |
| 12 | card initialize → `authorization_url` begins `https://checkout.paystack.com` |
| 13 | bank transfer → account number/name/bank present, expiry ≈ +15 min |
| 14 | post a `charge.success` whose amount is one pesewa more → `PAYMENT_AMOUNT_MISMATCH` HIGH, status `PENDING` |
| 15 | abandon a pending payment → `EXPIRED`; then settle it → `PAID` + `orphaned` + `PAYMENT_LATE_SETTLEMENT` |
| 16 | a three-tender sale (cash 30 / credit 30 / card 40) → credit ledger holds exactly 30 000 |
| 17 | reuse the card payment in a second sale → `REJECTED` `INVALID_TENDER` |
| 18 | refund cash 20 on the three-tender sale → `APPLIED`; the sale's three money columns unchanged; stock `+qty` |
| 19 | refund a `DAMAGED` line → **zero** `stock_movement` rows for that refund |
| 20 | refund the credit portion 30 → `credit_ledger_entry` of kind `REFUND`, `−30 000` |
| 21 | refund 60 against a 40 card tender → `REJECTED` `REFUND_EXCEEDS_TENDER` |
| 22 | refund exactly 20 000 → one `PENDING` `REFUND` approval, `deciderRole ADMIN` |
| 23 | decide the approval as admin → `APPROVED`; re-read the refund columns → identical |
| 24 | repayment cash 50 → balance drops exactly 50 000, `reference_number` is the till's |
| 25 | cart void with `OTHER` and no note → `REJECTED`; with a note → applied |
| 26 | close the shift → `Z` report exists; `X` equals it except `generatedAt` and counted/variance |
| 27 | recompute every Z figure from SQL and compare field by field |
| 28 | delete a `shift_report` row by hand → `Z` is a 500 `SHIFT_REPORT_MISSING`, not a recomputation |
| 29 | a manager closes another cashier's drawer with a variance over tolerance → the review's requester is the manager, and their own decide attempt is a **403** (P13-D41) |

Three figures are **re-derived from SQL rather than read back**: the split's tender identity, the
credit ledger's charge and refund, and the Z-report's cash expectation.

### 4. The console walkthrough — `evidence/walkthrough-console.txt`

Extend Phase 12's script:

- open the approvals inbox, filter `REFUND`, see the row with branch, value and age;
- open the detail: receipt number, the three restock badges, the tender list with statuses, the
  approving manager;
- approve it; re-read the refund through the API and assert every money column is unchanged;
- the operations summary's pending count drops by one.

Screenshots at 1440 px in `evidence/shots/`: `refund-approval-detail.png`,
`refund-approval-inbox.png`.

### 5. The till — `desktop/test/e2e/payment-drill.mjs`

The offline half is a gate, not a transcript:

- enrol, open a shift, sell for cash **with the network blocked at the API layer** (the script fails
  requests to `/api/` after enrolment), print, and assert the receipt shows one tender;
- hold two carts, restart the renderer, recall both, assert the labels and that the second recall
  carries the differences panel when a price changed;
- void a cart with `OTHER` and no note → refused; with a note → accepted, and the outbox row appears;
- refund the cash sale **offline** with a manager PIN, print the refund receipt, then restore the
  network and assert one `REFUND` upload;
- close the shift, print the Z-report, assert the drawer figures match the on-screen summary.

The online half runs against the mock provider: add a MoMo tender, settle it through the mock harness,
complete the sale, and assert the receipt prints `MoMo` and the payment reference.

`evidence/payment-drill.txt` records the run.

### 6. Eight mutations — `evidence/mutations.sh`, `mutations.txt`

Each is applied, the named test must fail, the mutation is reverted, and the run is recorded:

| # | Mutation | Must be caught by |
|---|---|---|
| 1 | `refundApprovalRequired` `>=` → `>` | the 20 000 boundary test |
| 2 | `applySale` drops the `payment.status === 'PAID'` check | the pending-payment tender test |
| 3 | `tenderBalance` lets change exceed the cash tender | `OVERPAID_BY_ELECTRONIC` |
| 4 | `applyRefund` stops checking per-tender remainders | `REFUND_EXCEEDS_TENDER` |
| 5 | `DAMAGED` starts posting a movement | the zero-movement test |
| 6 | the webhook accepts a body without verifying the signature | the 401 leg |
| 7 | a late settlement stops setting `orphaned` | the `PAYMENT_LATE_SETTLEMENT` test |
| 8 | the `REFUND` decision handler stamps `refunded_minor` | the immutable-money test |

A mutation that fails nothing is a gap, and the plan's Done-when forbids shipping it.

### 7. The proof this phase did not touch the sync contract

```bash
git diff --stat <phase-start>..HEAD -- powersync/sync-config.yaml powersync/service.yaml
```

must be empty, and `git diff --stat <phase-start>..HEAD -- powersync/` must show **no** change. The
till gained five local-only tables and no synced one; the header comment in `sync-config.yaml` still
tells the truth.

### 8. The OWASP table

Reproduce P13-D39 as a table in `13-VERIFICATION.md`, with each row pointing at a leg number, a test
name or a grep:

```bash
grep -rn "PAYSTACK_SECRET_KEY\|sk_live\|sk_test\|Bearer " api/src --include=*.ts | grep -v "env.ts\|payments.paystack.provider.ts"
grep -rn "last4\|\"bin\"\|authorization_code" api/src admin/src desktop/src
```

Both must return only the provider client and its env declaration — no DTO, no log, no local table.

### 9. `13-VERIFICATION.md`

An introduction stating the phase's goal in one paragraph, then:

1. the nine roadmap success criteria mapped one by one;
2. the ten requirements mapped one by one;
3. the OWASP table;
4. the eight mutations with the failing test named;
5. deviations, with the reason;
6. **known limits**, at minimum: refunds are terminal-scoped (P13-D25); a refund approval is
   retrospective by design; orphaned payments need a person; `DAMAGED` refunds are reported but not
   inventoried as shrinkage until Phase 14; approval expiry is still unimplemented; the console has no
   refund list until Phase 14.
7. the counts and the file count.

### 10. State

`STATE.md`: Phase 13 → complete, the next action becomes **Phase 14 — Admin Operations & E-VAT**, the
progress table and the "next action" paragraph are rewritten, and a "Phase 13 planning notes" section
records the six locked-context defects this plan set resolved (P13-D2, D22, D23, D24, D30, D35) with
one line each. `REQUIREMENTS.md` POS-15's correction (Plan 01) is referenced.

## Verification

```bash
bash .planning/phases/13-pos-payments-returns/evidence/run-suites.sh
node .planning/phases/13-pos-payments-returns/evidence/walkthrough-payments.mjs
bash .planning/phases/13-pos-payments-returns/evidence/mutations.sh
```

Expected: `ALL SUITES PASSED`; the walkthrough reports **0 failures** over its legs; every mutation is
caught.

## Commits

1. `test(phase-13): gate transcript from a database migrated from zero`
2. `test(phase-13): payments, refunds and the Z-report over the real API`
3. `test(admin): the refund approval in the console`
4. `test(desktop): the offline payment and refund drill`
5. `test: phase 13 mutation proofs`
6. `docs(planning): phase 13 verification, evidence and state`

## Done when

- Every roadmap criterion and requirement names a leg, a test or a screenshot.
- Eight mutations were caught by a named test.
- `powersync/` is unchanged and the till's five new tables are local-only.
- A cash sale, a cash refund and a Z-report all completed with the network unplugged.
- No card data, secret or provider body appears anywhere outside the provider client.
