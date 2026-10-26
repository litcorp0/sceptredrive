---
phase: 12-branch-ops-approvals
plan: 10
title: The operations summary read model
lane: api
depends_on: [03, 04, 05, 07, 08, 09]
requirements: [BRN-05, APR-05]
---

# Plan 10 — One request answers "what needs me today"

## Goal

The manager's branch view needs six counts and the age of the oldest thing waiting. This plan adds
one read model that returns them, so the page is one request rather than six, and so the branch
scoping is decided once.

## Read first

- `00-DECISIONS.md` P12-D35 … P12-D37.
- `api/src/modules/analytics/analytics.schema.ts` — a read-model module's header and `export {}`.
- `api/src/modules/replenishment/replenishment.schema.ts` — the same pattern.
- The list services this plan calls: `approvals.service.getApprovalSummary` (Plan 03),
  `transfers.service.listTransfers`, `writeoffs.service.listWriteOffs` (Plan 05),
  `inventory.service.listLowStock`, `credit.service.listOverLimit` (Plan 07),
  `pos.service.countShiftsAwaitingReview` (Plan 08).
- `api/src/auth/scope.ts:34-45` — `resolveBranchFilter`.

## Tasks

### 1. The one missing count (`pos.service.ts`)

```ts
/** Closed shifts in the branch whose variance is waiting for a reviewer. */
export async function countShiftsAwaitingReview(
  user: SessionUser, requestedBranchId?: string | null,
): Promise<{ count: number; branchId: string | null }>
```

`WHERE status = 'CLOSED' AND review_status = 'REQUIRED'`, branch-scoped through
`resolveBranchFilter`. No new table, no new column.

### 2. The module

`api/src/modules/operations/` — the seven files:

| File | Content |
|---|---|
| `operations.schema.ts` | header + `export {}`: the module owns no tables; every figure is read through the owning module's service |
| `operations.repository.ts` | header + `export {}`: no data access here, deliberately — a repository that reached into six tables would be the boundary Phase 9 forbade (P9-D10) |
| `operations.types.ts` | `OperationsSummary`, `OperationsQueue` |
| `operations.validation.ts` | `operationsSummaryQuerySchema = z.object({ branchId: z.uuid().optional() }).strict()` |
| `operations.service.ts` | `getOperationsSummary(user, query)` |
| `operations.controller.ts` | one handler |
| `operations.routes.ts` | one route |

```ts
interface OperationsQueue {
  count: number
  /** The oldest waiting row, or null. Present for the approvals queue only. */
  oldest?: { id: string; type: ApprovalType; requestedAt: string; amountMinor: number | null }
}

interface OperationsSummary {
  branchId: string | null
  approvals: OperationsQueue & { byType: Record<ApprovalType, number> }
  transferRequests: OperationsQueue
  writeOffs: OperationsQueue
  shiftVariances: OperationsQueue
  lowStock: OperationsQueue
  overLimitCredit: OperationsQueue
  countAccuracyBp: number | null
}
```

`getOperationsSummary` resolves the branch once (`resolveBranchFilter`) and calls each owner with
`limit: 1`, reading `total`; `countAccuracyBp` comes from
`counts.service.getCountAccuracy(user, { branchId, from: start of month, to: today })`.

**Permission filtering.** A section is included only when the caller holds the underlying
permission, so a future role that can see approvals but not credit does not get credit figures:

| Section | Requires |
|---|---|
| approvals | `approval.read` |
| transferRequests | `inventory.read` |
| writeOffs | `inventory.read` |
| shiftVariances | `approval.read` |
| lowStock | `inventory.read` |
| overLimitCredit | `credit.read` |
| countAccuracyBp | `inventory.read` |

A section the caller cannot see is **absent**, not zero — zero means "nothing waiting", and that
is a different statement.

### 3. Route

| Method | Path | Permission |
|---|---|---|
| GET | `/api/operations/summary` | `approval.read` |

`api/src/app.ts` mounts `operationsRoutes` (the third and last `app.ts` edit; Plans 03 and 05 made
the others). The service enforces branch scope a second time, per P11-D17.

### 4. Tests (`operations.test.ts`)

- a fixture branch with 2 pending approvals (different types), 1 requested transfer, 1 pending
  write-off, 1 shift awaiting review, 2 low-stock parts and 1 over-limit customer → every count is
  the hand-counted number, and `approvals.byType` has a zero for types with nothing waiting;
- `oldest` is the earliest `requestedAt` of the pending set;
- manager asking for another branch → 403; admin with no `branchId` → every branch's figures,
  `branchId: null`;
- each count equals the `total` of the corresponding list endpoint with the same filters (the
  parity test that stops the summary drifting from the lists);
- a manager without `credit.read` (constructed by calling the service with a user object whose role
  is `MANAGER` and whose permission set is stubbed) does not receive `overLimitCredit`;
- `countAccuracyBp` is `null` when the month has no posted count;
- 401 unauthenticated, 403 cashier.

## Verification

```bash
bun run --filter api test
bun run check-types
bun run lint
```

Expected: API grows by ~10. `EXPLAIN (ANALYZE, BUFFERS)` on the composed summary on the seeded demo
month is recorded; each sub-read is an indexed count, and the whole endpoint must stay under
**150 ms** p95 (it is six counts, not six list pages).

## Commits

1. `feat(api): shifts awaiting review count`
2. `feat(api): operations summary read model`
3. `test(api): summary parity with the underlying lists`

## Done when

- The manager's page is one request, and every number on it equals the list it links to.
- A section the caller may not see is absent, not zero.
- A manager cannot obtain another branch's queue by changing a parameter.
