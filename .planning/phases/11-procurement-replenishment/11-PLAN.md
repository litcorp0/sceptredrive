---
phase: 11-procurement-replenishment
plan: 11
title: Verification, evidence, and state update
lane: verification (read-only) + controller
depends_on: [10]
requirements: [PROC-01, PROC-02, PROC-03, PROC-04, PROC-05, PROC-06, PROC-07, PROC-08, PROC-09, PROC-10, MGR-01, MGR-02, MGR-03, MGR-04, MGR-05]
---

# Plan 11 — Prove the phase, backwards from the goal

## Goal

Demonstrate — with commands, queries and screenshots — that a manager can decide what to order
from real numbers, raise an order, have it approved when it matters, receive against it in every
delivery shape, send goods back with a correct credit, and read a supplier's record. And prove
that nothing else in the system changed, especially the POS.

This plan writes no feature. If it finds a defect, the fix belongs to the plan that owns the file,
and the defect is recorded here.

## Read first

- `ROADMAP.md` Phase 11, success criteria 1–10.
- `REQUIREMENTS.md` PROC-01…10, MGR-01…05.
- `00-CONTEXT.md` and `00-DECISIONS.md` — the criteria are read against *these*, not against a
  memory of them.
- `.planning/phases/09-analytics-dashboard/evidence/` and
  `.planning/phases/10-desktop-pos-redesign/01-VERIFICATION.md` — the evidence style: a transcript
  per gate, a table mapping criterion → proof, and defects listed rather than smoothed.

## Tasks

### 1. Fresh database, real stack

```bash
docker compose down -v && docker compose up -d
bun run db:migrate
bun run db:test:prepare
bun run db:seed            # admin + demo master data
bun run --filter api dev & # :4000
bun run --filter admin dev & # :3000
```

Then create the phase fixtures through the **API**, not SQL, so the services are exercised:
two branches (one retail, one warehouse), three suppliers with different lead times, twelve
products (one with no stock row at the retail branch, one with no preferred supplier), staff
(admin, two managers), and thresholds. The fixture script lives in
`evidence/walkthrough-procurement.mjs` and creates everything per run with a unique suffix — never
borrow the demo seed's supplier, which Phase 9's demo month has already invoiced.

### 2. API walkthrough — `evidence/walkthrough-procurement.mjs`

One script, run against the real API on `:4000`, printing a numbered assertion per line.

| # | Leg | Assertion |
|---|---|---|
| 1 | Create a draft below the limit | `DRAFT`, number matches `/^PO-[A-Z0-9]+-\d{6}-\d{4}$/`, goods value = Σ qty × cost |
| 2 | Submit below the limit | `APPROVED`, **no** approval row, audit `purchase_order.auto_approved` reason `THRESHOLD` |
| 3 | Admin raises an order above the limit | `APPROVED`, reason `ADMIN_REQUEST`, no approval row |
| 4 | Manager raises an order at the limit | `PENDING_APPROVAL`, approval `amountMinor` = the value |
| 5 | Manager tries to decide it | **403** |
| 6 | Admin decides it | `APPROVED`; `decided_by ≠ requested_by` |
| 7 | Approve it again | **409**, nothing changes |
| 8 | Edit the approved order | **409** |
| 9 | Send it | `SENT` with `sent_at` |
| 10 | Receive 6 of 10 | `PARTIALLY_RECEIVED`; on hand +6; receipt number `GRN-…`; supplier link created with `last_cost_minor` |
| 11 | Receive 4 of 10 | `RECEIVED`; on hand +10 total; ledger equals on hand |
| 12 | Over-deliver 2 without a reason | **400**, nothing written |
| 13 | Over-deliver 2 with `SUPPLIER_SENT_MORE` | accepted; `over_receipt_reason` stored; on hand reflects it |
| 14 | Invoice matched at the PO price, qty ≤ received | `MATCHED`; payable posts; balance = invoice |
| 15 | Invoice at a higher price | `PRICE_VARIANCE`; **payable posts**; both values in the audit |
| 16 | Invoice for more than received | `QUANTITY_VARIANCE`; payable posts |
| 17 | Invoice naming a cancelled order | **409** |
| 18 | Return 2 against a receipt line | draft posts nothing; after posting: `-2` movement type `SUPPLIER_RETURN`, credit note `SCN-…`, balance reduced by exactly 2 × unit cost |
| 19 | Return more than received minus returned | **400** before anything is written |
| 20 | Reconcile | `invoiceOutstanding − creditNotes = owedMinor`; `reconcilePayables` reports no drift |
| 21 | Stock ledger | `Σ quantity_delta = quantity_on_hand` for every product/branch touched |
| 22 | Catalog cost | equals the latest receipt cost; a transfer-in did not change it |
| 23 | Suggestions | one row checked by hand: `suggested` equals the three SQL facts run independently |
| 24 | On-order | the same product on an open order no longer suggests the ordered quantity |
| 25 | Product submission | manager submits → zero products; admin approves → one product, `cost_price_minor = 0`; admin rejects another → still zero |
| 26 | **IDOR set** | manager of branch A: read B's order → 403; receive B's order → 403; return B's receipt → 400/403; decide B's approval → 403; list with `branchId=B` → 403 |
| 27 | Cashier | every `/api/procurement/**` and `/api/replenishment/**` route → 403 |
| 28 | Validation | an extra field in each of five bodies → 400 (`.strict()`) |

The script prints `PASS n`/`FAIL n (expected … got …)`, exits non-zero on any failure, and its
whole output is committed as `evidence/walkthrough-procurement.txt`.

### 3. Console walkthrough

`admin/test/walkthrough-sections.mjs` — append to `SECTIONS`:

```js
["/procurement/orders", "Purchase orders"],
["/procurement/replenishment", "What to order"],
["/procurement/suppliers", "Which suppliers deliver"],
```

and add the manager leg: a manager visiting `/procurement/orders` sees no approve button, no
branch switcher, and no other branch's orders — asserted by counting the rows and reading a
branch column, not by trusting a hidden control.

Screenshots (1024 × 768 and 1440 × 900, light) into `evidence/shots/`:

- `plan11-orders-list.png`, `plan11-order-detail-pending.png`, `plan11-order-detail-approved.png`,
  `plan11-receive-dialog.png` (with the over-delivery reason visible),
  `plan11-return-dialog.png`, `plan11-approval-panel.png`,
  `plan11-replenishment.png` (one basis expanded), `plan11-supplier-performance.png`,
  `plan11-print-preview.png`.

Zero console errors and zero failed requests on every section, as the existing walker already
enforces.

### 4. The gates, in one transcript

`evidence/run-suites.sh` runs and tees to `evidence/suites.txt`:

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

Recorded baseline (Phase 10 close): shared **149**, API **394**, desktop **413**, `modules:check`
14/14 POS and 15/15 admin, brand gate over 880 tracked files. Phase 11 must move only shared and
API; **desktop must still read 413** and the admin gate 17/17.

### 5. Prove the gates can fail (mutation)

Each mutation is applied, the named test is required to fail, and the mutation is reverted. This
is the Phase 10 lesson: a gate that cannot fail is a transcript, not a gate.

| Mutation | Must fail |
|---|---|
| `requiresApproval` uses `>` instead of `>=` | the threshold boundary test at exactly 1 000 000 |
| Remove `assertBranchAccess` from `getOrder` | the IDOR leg (26) |
| Remove the over-receipt reason guard | the over-delivery test (12) |
| Remove the self-approval check in `decideApproval` | the self-approval test |
| Stop subtracting credit notes in `sumSupplierOwed` | the archive-blocked test |
| Drop `.strict()` from `orderCreateSchema` | the extra-field validation leg (28) |

Record each in `11-VERIFICATION.md` with the test name and the failure message.

### 6. Prove the POS is untouched

```bash
git diff --stat <phase-start>..HEAD -- desktop/ powersync/
# must be empty

git diff <phase-start>..HEAD -- desktop/src/renderer/lib/powersync/schema.ts
# must be empty: no local schema change, so no terminal migration
```

And re-run the desktop gate suite that Phase 10 left green — `bun run --filter desktop test`
(413) — recording the count. The packaged shell/print E2E is **not** re-run: it needs a packaged
build and this phase changes no desktop file, which the empty diff already proves. That reasoning
is written down rather than left implicit.

### 7. OWASP acceptance table

| Control | Evidence |
|---|---|
| A01 deny by default | leg 26 and 27; every route file's `requirePermission` listed |
| A01 object-level | leg 26: four different foreign-entity requests, four refusals |
| A02 misconfiguration | settings screen shows the admin-only flag; a manager's attempt is a 403 in leg 26 |
| A05 injection | `grep -rn "sql\`" api/src/modules/{procurement,replenishment}` — every interpolation is a column reference, no string-built predicate |
| A06 design | threshold default applies when unset (test), self-approval has no path (test), return caps re-checked in-transaction (test) |
| A08 integrity | posted return cannot be cancelled; approval decided once; ledger totals reconcile in leg 21 |
| A09 logging | every state change has an `audit_log` row — counted in the walkthrough (`SELECT action, count(*) … GROUP BY action`) |
| A10 fail-closed | unauthenticated is 401; unknown id is 404; foreign id is 403; a missing setting falls back to the documented default |

### 8. Documentation and state

- `00-CONTEXT.md` gains an **"Amendments (2026-10-26)"** section folding in P11-D1…D20, with a
  footnote where a decision contradicts the locked table (D7's `reorder_quantity`, D11's numbering
  sentence, D5's header-only link).
- `00-DECISIONS.md` gets a footer listing which decisions were exercised by which plan.
- `.planning/STATE.md`:
  - Progress table: Phase 11 → ✅ Complete (11/11 plans, verified).
  - Execution notes: the numbers (shared/API/desktop), the defects found, the deviations, and the
    carry-forwards.
  - **Next action: plan Phase 12 (Branch Operations & Approval Workflow).**
- `AGENTS.md`: correct the "Test command" note header that still says `bun test` while its body
  says `bun run test` (`01-RESEARCH.md` defect 4). One line.

## Verification of the verification

- Every roadmap criterion 1–10 has a row in `11-VERIFICATION.md` naming a command, a leg number, or
  a screenshot. No criterion is satisfied by "the plan was executed".
- Every one of PROC-01…10 and MGR-01…05 maps to at least one assertion or test.
- The fresh-database cycle ran end to end in one sitting; if any step was skipped, it is named as
  not proven rather than omitted.
- The mutation table has six entries, all reverted, all recorded.

## Commits

1. `test(api): the procurement walkthrough script`
2. `test(admin): procurement sections in the console walkthrough`
3. `docs(planning): phase 11 verification and evidence`
4. `docs(planning): amend the phase 11 context with the decisions taken`
5. `docs: correct the test command note in AGENTS.md`

## Done when

- `evidence/suites.txt` is a complete transcript with every suite green and the counts recorded.
- `evidence/walkthrough-procurement.txt` shows 28 legs passing against a fresh database.
- The six mutations each produce the failure they were written to cause.
- `git diff --stat` over `desktop/` and `powersync/` is empty and that is stated as the proof.
- `11-VERIFICATION.md` maps all ten roadmap criteria to evidence and lists every defect found.
- `STATE.md` says Phase 12 is next.
