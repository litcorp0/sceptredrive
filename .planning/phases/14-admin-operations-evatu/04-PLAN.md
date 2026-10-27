---
phase: 14-admin-operations-evatu
plan: 04
title: The conflict queue and the act of resolving one
lane: api
depends_on: [03]
requirements: [ADM-07]
---

# Plan 04 — A conflict is a record; resolving it is another record

## Goal

A manager sees every open conflict in their branch, oldest first or worst first, opens the
sale or shift it points at, and closes it with a code and a note. The sale, the movement and
the ledger are byte-identical afterwards, and the till's badge clears on its next sync
because the status it already reads has changed.

## Read first

- `00-DECISIONS.md` P14-D7, D13, D14, D15.
- `01-RESEARCH.md` facts 17–21, 25.
- `api/src/modules/pos/pos.schema.ts:333-365` — the row, its three unused resolution
  columns, and its indexes.
- `api/src/modules/pos/pos.conflicts.ts:15-50` — the writer's PII rule and the fact that
  every row is created `OPEN`.
- `api/src/modules/pos/pos.service.ts:1840-1862` — where sale conflicts are written, one
  audit row each, and `sale.conflictCount` is set.
- `api/src/modules/sync/sync.service.ts:572-595` and `pos.repository.ts:548-587` — the
  device list and count that must reflect a resolution.
- `api/src/modules/analytics/analytics.repository.ts:393-401` — the dashboard severity
  count.
- `packages/shared/src/conflicts.ts` (Plan 01) — `resolutionProblem`, the labels.

## Tasks

### 1. Reads

`GET /api/pos/oversight/conflicts` under `requirePermission('conflict.read')`:

| Query | Notes |
|---|---|
| `branchId` | admin only; a manager is forced to theirs |
| `status` | `OPEN` (default), `RESOLVED`, `DISMISSED`, `ALL` |
| `type`, `severity` | single value each |
| `saleId`, `shiftId`, `terminalId` | exact |
| `from`, `to` | Accra half-open on `created_at` |
| `limit` 1–50 default 20, `offset` | |

Row: `id, type, severity, status, createdAt, branchCode, terminalCode,
saleId, receiptNumber, shiftId, shiftNumber, resolvedBy, resolvedAt, resolutionCode,
resolutionNote, details`. `details` for a list row is the same flat jsonb the queue's
writer produced; nothing is widened and nothing is redacted at read time because nothing
PII was ever written.

`GET /api/pos/oversight/conflicts/:id` adds `subject`: a minimal reference to the linked
document — for a sale `{ kind: 'sale', id, receiptNumber, occurredAt, totalMinor,
conflictCount }`, for a shift `{ kind: 'shift', id, number, openedAt, closedAt,
varianceMinor }`, and `{ kind: 'none' }` for a rejected upload whose `sale_id` is null and
whose only link is `details.clientTransactionId` (the `UNKNOWN_PRODUCT` case).

The list is sorted `severity` (HIGH first) then `created_at` ascending: the oldest
unreviewed HIGH conflict is the one that has been wrong longest. `status = 'OPEN'` is the
default because a queue that opens on "everything, ever" is a log, not a queue.

### 2. The resolution

`PATCH /api/pos/oversight/conflicts/:id` under `requirePermission('conflict.resolve')`:

```ts
const resolveConflictSchema = z.object({
  status: z.enum(['RESOLVED', 'DISMISSED']),
  code: z.enum(CONFLICT_RESOLUTION_CODES),
  note: z.string().trim().max(500).nullish(),
}).strict().superRefine((value, ctx) => {
  const problem = resolutionProblem(value)
  if (problem) ctx.addIssue({ code: 'custom', message: problem })
})
```

Service steps, in this order:

1. `resolveBranchFilter` on the row's `branchId`; a foreign branch is a 403.
2. `SELECT … FOR UPDATE` the row, then refuse unless `status = 'OPEN'` with
   `ConflictError('CONFLICT_ALREADY_RESOLVED')` — 409, because two managers pressing the
   same button is normal, not an error worth a 400.
3. Update `status`, `resolution_code`, `resolution_note`, `resolved_by` (the actor's
   `staffId`, or the user id when the account has none), `resolved_at = now()`.
4. One audit row, `pos.conflict.resolved`, entity `sync_conflict`, entity id, branch,
   `before: { status: 'OPEN', resolutionCode: null }`,
   `after: { status, resolutionCode, resolutionNote }`, plus `details` for the record.
   No sale id, no customer, no PII in the payload beyond what the row already held.

**Nothing else is written.** No `sale`, `refund`, `shift`, `stock_movement`,
`credit_ledger_entry` or `loyalty_ledger_entry` statement appears in this service, and the
test in Task 5 proves it rather than asserting the intention.

### 3. What the console is allowed to say

`PAYMENT_LATE_SETTLEMENT` resolves with `TILL_INSTRUCTION` and a note naming the terminal
that must claim the payment (`POST /api/pos/payments/:id/claim`, already device-gated,
P14-D15). The API does not gain a claim endpoint, and the conflict's `details` still holds
`paymentId` so the note can be checked against it.

There is no re-validation step and no "resolve and retry". A resolution is a judgement; the
correction is a new document, and if a manager needs one they use the module that owns it.

### 4. The counters follow

No code change is needed for the dashboard (`analytics.repository.ts:393-401` counts
`status = 'OPEN'`) or the till (`sync.service.ts:597-610` counts `status = 'OPEN'`). This
plan proves both by test instead of touching them, because the temptation will be to add a
"recently resolved" count and that is how a badge starts disagreeing with a queue.

### 5. Tests — `pos.conflicts.test.ts`

Fixtures: two branches, a manager each, an admin, and a sale that raised three conflicts
(`STOCK_OVERSELL`, `PRICE_MISMATCH`, `CLOCK_SKEW` — the existing fixtures at
`pos.test.ts:990-1126` produce all three).

- a manager sees only their branch's open conflicts; `?branchId=<other>` is a 403;
- the default list excludes a `RESOLVED` row and `?status=ALL` includes it;
- HIGH sorts before LOW and, within a severity, oldest first;
- resolving writes the five columns, returns the row, and writes exactly one audit row
  with the before/after above;
- resolving a second time is a **409** and changes nothing (compare `resolvedAt`);
- `DISMISSED` without a note is a 400 naming the rule; `RESOLVED` without a code is a 400;
- a code outside the enum is a 400 from Zod, before the service;
- a cashier without `conflict.resolve` is a 403 and without `conflict.read` is a 403;
- **the documents are untouched**: take `md5(string_agg(…))` over `sale`, `sale_line`,
  `sale_tender`, `stock_movement`, `credit_ledger_entry` and `loyalty_ledger_entry` for the
  sale, resolve, and compare — all six identical;
- the device-facing `GET /api/pos/sync/conflicts` now returns the row with
  `status: 'RESOLVED'`, and `GET /api/pos/sync/state`'s `pendingConflicts` has fallen by
  one — the till needs no change to clear its badge;
- `GET /api/analytics/overview`'s `openConflictCount` has fallen by one;
- a `PAYMENT_LATE_SETTLEMENT` row resolves with `TILL_INSTRUCTION`, and its `payment` row
  is unchanged (`status`, `orphaned`, `paidAt` all identical);
- an unknown id is a 404; a malformed uuid is a 400 from the param validator.

## Verification

```bash
bun run --filter api test     # ~760 → ~780
bun run check-types
```

By hand: open three conflicts in the demo seed, resolve one as `CONFIRMED` and one as
`DISMISSED` with a note, and watch the dashboard tile, the till badge and the queue all
agree on the same number.

## Commits

1. `feat(api): the conflict queue, severity-first and branch-scoped`
2. `feat(api): resolving a conflict writes the code, the note and one audit row`
3. `test(api): resolution leaves six tables byte-identical and clears two counters`

## Done when

- Every open conflict in a branch is visible with the document it belongs to.
- No resolution can touch the thing it is about.
- A manager can explain, a year later, why a HIGH conflict was accepted.
