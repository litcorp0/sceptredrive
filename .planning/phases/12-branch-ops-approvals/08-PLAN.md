---
phase: 12-branch-ops-approvals
plan: 08
title: Shift variance review
lane: api
depends_on: [03]
requirements: [BRN-04, APR-01, APR-02, APR-04]
---

# Plan 08 — A drawer that does not balance gets a person's name on it

## Goal

A shift closed with a variance beyond the branch's tolerance is marked for review and appears in
the same inbox as everything else. A reviewer — the branch manager, or the admin when the manager
is the one who closed it — records an outcome. The shift's money figures are never touched, and the
POS keeps selling exactly as it does today.

## Read first

- `00-DECISIONS.md` P12-D24 … P12-D27.
- `01-RESEARCH.md` §4 items 29–31.
- `api/src/modules/pos/pos.service.ts:376-385,558-647` — `computeExpectedCash`, `closeShift`, the
  conflict path and `ShiftApplyResult`.
- `api/src/modules/pos/pos.schema.ts:18,57-98` — the shift table and the review columns from
  Plan 02.
- `api/src/modules/pos/pos.repository.ts:215-233` — `findShiftByIdForUpdate`.
- `api/src/modules/pos/pos.reconciliation.ts:248-331` — the check that must keep passing.
- `api/src/modules/approvals/approvals.service.ts` (Plan 03).
- `desktop/src/renderer/lib/shift/shift-service.ts:237-293` — read only: the client's close payload
  is **not** changing.

## Tasks

### 1. Raise the review inside the close

`closeShift` already computes `variance = countedCashMinor - serverExpected` and stores it. After
the existing `updateShiftClose` call, in the **same** `executor` transaction:

```ts
const tolerance = await getSettingValue('pos.shiftVarianceToleranceMinor',
  { branchId: row.branchId }, executor)

if (Math.abs(variance) > tolerance) {
  await updateShiftReview(payload.shiftId, { reviewStatus: 'REQUIRED' }, executor)
  await requestApproval(actor, {
    type: 'SHIFT_VARIANCE_REVIEW',
    entityId: payload.shiftId,
    branchId: row.branchId,
    amountMinor: Math.abs(variance),
    deciderRole: 'MANAGER',
    deciderBranchId: row.branchId,
    note: payload.closeNote ?? null,
    payload: {
      shiftId: payload.shiftId,
      terminalName,          // joined once, for the inbox row
      expectedMinor: serverExpected,
      countedMinor: payload.countedCashMinor,
      varianceMinor: variance,
    },
  }, executor)
}
```

- **Strictly greater** than tolerance (BRN-04: "beyond tolerance"). A variance of exactly GHS 20
  with a GHS 20 tolerance raises nothing.
- The requester recorded on the approval is the actor of the upload — the cashier's staff label
  from `closedBy`/the device actor, which is what makes the no-self-approval rule meaningful.
- The approval is created **inside the existing upload transaction**: a failure rolls the close back
  and the outbox retries, which is safe because the close is idempotent by shift id. The upload's
  response shape (`ShiftApplyResult`) is unchanged — the POS never learns an approval exists
  (APR-06).

### 2. The decision handler

```ts
registerDecisionHandler('SHIFT_VARIANCE_REVIEW', async (tx, approval, actor, decision, input) => {
  if (decision !== 'APPROVED') {
    throw new ValidationError('A variance review records an outcome; it cannot be rejected')
  }
  if (!input.note || input.note.trim().length < 3) {
    throw new ValidationError('Record what you found before closing the review')
  }
  const shift = await findShiftByIdForUpdate(approval.entityId!, tx)
  if (!shift) throw new NotFoundError('Shift not found')
  if (shift.status !== 'CLOSED') throw new ConflictError('This shift is not closed')
  if (shift.reviewStatus !== 'REQUIRED') throw new ConflictError('This shift is not awaiting review')
  await updateShiftReview(shift.id, {
    reviewStatus: 'REVIEWED',
    reviewedBy: actorLabel(actor) ?? 'unknown',
    reviewedAt: new Date(),
    reviewNote: input.note.trim(),
  }, tx)
  await writeAudit({ ...actor, action: 'pos.shift.reviewed', entity: 'shift', entityId: shift.id,
    branchId: shift.branchId,
    before: { reviewStatus: 'REQUIRED', varianceMinor: shift.varianceMinor },
    after: { reviewStatus: 'REVIEWED', reviewNote: input.note.trim(), approvalId: approval.id } }, tx)
})
```

The money columns are not in the `updateShiftReview` patch and `updateShiftReview` is the only new
writer of the review columns. A test compares the three money columns before and after the decision.

### 3. Subject loader

```ts
registerSubjectLoader('SHIFT_VARIANCE_REVIEW', async (approval) => {
  const shift = await findShiftWithTerminal(approval.entityId!)
  return { kind: 'shift_variance', shiftId: shift.id, terminalName: shift.terminalName,
    expectedMinor: shift.serverExpectedCashMinor, countedMinor: shift.countedCashMinor,
    varianceMinor: shift.varianceMinor }
})
```

The detail also returns the shift number, the cashier's name, `openedAt`/`closedAt`, the sale count
and the client-expected figure, so the reviewer can see whether the terminal and the server agreed
about the arithmetic (`SHIFT_VARIANCE_MISMATCH`) as distinct from the drawer being wrong.

### 4. Read side

No new shift list (that is Phase 14's oversight screen). Two additions only:

- `getShiftReview(user, shiftId)` is not needed — the approval detail carries the subject.
- The operations summary (Plan 10) counts `shift.review_status = 'REQUIRED'` for the branch.

### 5. Tests (`pos.test.ts`, `shift-review.test.ts`)

- close with `|variance| = tolerance` → `review_status = 'NONE'`, **zero** approvals;
- close with `|variance| = tolerance + 1` → `REQUIRED`, one `PENDING` approval with
  `amountMinor = |variance|`, `deciderRole = 'MANAGER'`, `deciderBranchId` = the shift's branch;
- a positive and a negative variance both trigger (absolute value);
- manager of the same branch approves with a note → `REVIEWED`, `reviewed_by` set,
  `review_note` stored; `counted_cash_minor`, `server_expected_cash_minor`, `variance_minor` are
  unchanged (asserted column by column);
- the cashier who closed the shift is the requester, so they cannot decide it (403) even if they
  are a manager in that branch;
- admin approves → `REVIEWED`;
- `REJECTED` → 400; no note → 400; note of two characters → 400;
- decide twice → 409;
- the existing reconciliation check (`reconcileShifts`) still reports zero problems for the reviewed
  shift;
- the POS upload response for `SHIFT_CLOSE` is byte-identical to Phase 11's fixture (no new field).

## Verification

```bash
bun run --filter api test
bun run check-types
bun run lint
git diff --stat -- desktop/ powersync/     # must be empty
```

Expected: API grows by ~14. The desktop suite is untouched at **421**; run it anyway in Plan 13.

## Commits

1. `feat(api): shift close raises a review above the branch tolerance`
2. `feat(api): variance review records an outcome and never edits the figures`
3. `test(api): tolerance boundary, self-review block and immutable shift money`

## Done when

- A variance beyond tolerance has a name against it before the week is out, or it is visibly
  waiting.
- The shift's money columns are byte-identical before and after the review.
- The till's close payload and response have not changed.
