---
phase: 12-branch-ops-approvals
plan: 03
title: Approvals core — per-row authority, subject registry, inbox and summary
lane: api
depends_on: [02]
requirements: [APR-01, APR-02, APR-03, APR-04, APR-05, APR-06]
---

# Plan 03 — One queue, one authority rule, one place to look

## Goal

The approval entity becomes the thing context D1 promised: a single inbox whose authority is a
property of the request, whose detail carries the evidence a decision needs, and whose reads are
scoped to both sides of a request. Phase 11's purchase orders keep working through the new
permissions, and nothing about a sale changes.

## Read first

- `00-DECISIONS.md` P12-D1 … P12-D8.
- `packages/shared/src/approvals.ts` (Plan 01) — `canDecideApproval`, `defaultApprovalAuthority`.
- `api/src/modules/approvals/` — all seven files.
- `api/src/auth/scope.ts:22-45` — `assertBranchAccess`, `resolveBranchFilter`.
- `api/src/http/authorize.ts` — `requirePermission`.
- `api/src/app.ts:39-70` — the boot assertion and route mounts.
- `api/src/modules/procurement/procurement.service.ts:282-362,734-780` — the PO request, handler,
  and `withdrawPendingApproval`.
- `api/src/modules/approvals/approvals.test.ts` — the tests that will change.

## Tasks

### 1. Repository

```ts
selectApprovalPage(filters: {
  type?; status?; entityId?; sort: 'oldest' | 'newest'; limit; offset;
  scope: { branchId: string } | null;   // null = admin, every branch
  includeDeciderBranch: boolean;        // true for a manager: branch_id = X OR decider_branch_id = X
}, executor = db)

countPendingByType(scope: { branchId: string } | null, executor = db): Promise<Array<{ type: ApprovalType; count: number }>>
```

`includeDeciderBranch` exists because a transfer request is **raised at the destination** and
**decided by the source manager** (P12-D11). A manager who cannot see it cannot decide it. The
predicate is `(branch_id = $1 OR decider_branch_id = $1)`; for an admin it is `true`.

Ordering is `requested_at ASC` for `oldest` (the default) and `DESC` for `newest`, with `id` as the
tiebreaker so pagination is stable.

### 2. Service — request

```ts
export interface ApprovalRequestInput {
  type: ApprovalType
  entityId?: string | null
  branchId: string
  amountMinor?: number | null
  payload?: Record<string, unknown>
  note?: string | null
  deciderRole?: Role                       // default: defaultApprovalAuthority(type, branchId)
  deciderBranchId?: string | null          // default: branchId when the role is MANAGER, else null
}
```

`requestApproval` validates `deciderRole` with `isRole` and enforces the pairing:
`deciderRole === 'MANAGER'` **requires** a `deciderBranchId`; `deciderRole === 'ADMIN'` **requires**
`null`. A malformed pairing is a `500 INTERNAL` — it is a programming error, not a user error.

Everything else about the insert (audit `approval.requested`, caller's transaction) is unchanged.

### 3. Service — decide

Replace the two-step `roleOf(user) === approvalDeciderRole(type)` + self check with one call:

```ts
const canDecide = canDecideApproval({
  approval: {
    status: current.status,
    deciderRole: current.deciderRole as Role,
    deciderBranchId: current.deciderBranchId,
    requestedBy: current.requestedBy,
  },
  user: {
    role: roleOf(user),
    branchId: branchScope(user),
    label: actorLabel(actor) ?? 'unknown',
    hasDecidePermission: hasPermission(user, 'approval.decide'),
  },
})
if (!canDecide) throw new ForbiddenError('You cannot decide this request')
```

Order inside the transaction is unchanged from Phase 11 (`approvals.service.ts:130-215`):
permission → rejection-reason check → `lockApprovalForUpdate` → decided → authority → handler →
`updateApprovalDecision` → audit. **The branch check changes**:

```ts
// The decider must belong to the deciding branch; the requester's branch is the fallback.
const decidingBranch = current.deciderBranchId ?? current.branchId
assertBranchAccess(user, decidingBranch)
```

Phase 11's `assertBranchAccess(user, current.branchId)` would 403 the source manager on a transfer
request, whose `branchId` is the destination. That is the bug this line exists to prevent.

`getApproval` allows either side to read: `assertBranchAccess(user, current.branchId)` **or**
`current.deciderBranchId !== null && branchScope(user) === current.deciderBranchId`. A manager
sees their own request and the requests they must decide; nothing else.

### 4. Service — subject registry

```ts
export type SubjectLoader = (approval: ApprovalRow) => Promise<ApprovalSubject>
export function registerSubjectLoader(type: ApprovalType, loader: SubjectLoader): void
export function assertSubjectLoadersRegistered(required: readonly ApprovalType[]): void
export function registeredSubjectTypes(): ApprovalType[]
```

`buildDetail` becomes async and awaits the loader for the type. A missing loader throws
`AppError(500, 'INTERNAL', …)` — the same shape as a missing decision handler. The list endpoint
does **not** load subjects (a page of 50 must not run 50 loaders); it returns the row plus a
`subjectKind` discriminator so the inbox can render an icon and a link without the payload.

`ApprovalSubject` gains arms for every Phase 12 type (each plan adds its own in the same commit as
its loader):

```ts
type ApprovalSubject =
  | { kind: 'purchase_order'; purchaseOrderId: string }
  | { kind: 'product'; proposal: unknown }
  | { kind: 'transfer'; transferId: string; fromBranchId: string; toBranchId: string; lineCount: number }
  | { kind: 'stock_write_off'; writeOffId: string; number: string; lineCount: number }
  | { kind: 'price_change'; productId: string; branchId: string; currentPriceMinor: number; proposedPriceMinor: number }
  | { kind: 'credit_limit_change'; customerId: string; branchId: string; currentLimitMinor: number; proposedLimitMinor: number; balanceMinor: number }
  | { kind: 'shift_variance'; shiftId: string; terminalName: string; expectedMinor: number; countedMinor: number; varianceMinor: number }
  | { kind: 'other' }
```

### 5. Service — list and summary

```ts
export async function listApprovals(user, query: ApprovalListQuery): Promise<ApprovalList>
export async function getApprovalSummary(user, requestedBranchId?: string): Promise<ApprovalSummary>
```

`listApprovals` resolves `scope = resolveBranchFilter(user, query.branchId)` and passes
`includeDeciderBranch: scope !== null`. A manager filtering by an explicit foreign `branchId` still
gets a 403 from `resolveBranchFilter` — unchanged.

`getApprovalSummary` returns `{ pending, byType, branchId }` for `status = 'PENDING'` only. It is
the badge and the manager's view (P12-D5). `byType` includes a zero for every type the caller can
see, so a client never has to guess whether a missing key means zero.

### 6. Validation and routes

`approvals.validation.ts`:

```ts
sort: z.enum(['oldest', 'newest']).default('oldest')
entityId: z.uuid().optional()
```

| Method | Path | Permission |
|---|---|---|
| GET | `/api/approvals` | `approval.read` |
| GET | `/api/approvals/summary` | `approval.read` |
| GET | `/api/approvals/:id` | `approval.read` |
| POST | `/api/approvals/:id/decide` | `approval.decide` |
| POST | `/api/approvals/:id/withdraw` | `approval.read` + requester check in the service |

`/summary` is registered **before** `/:id` so the literal is not swallowed by the uuid param
validator (which would 400 on `summary`).

### 7. Boot assertion

`api/src/app.ts:39-41` keeps asserting the two types Phase 11 implemented:

```ts
assertDecisionHandlersRegistered(['PRODUCT_CREATE', 'PURCHASE_ORDER'])
assertSubjectLoadersRegistered(['PRODUCT_CREATE', 'PURCHASE_ORDER'])
```

Each of Plans 04–08 adds **its own** type to both lists in the same commit that registers its
handler and loader. That is five more small `app.ts` edits in one lane, and it is the only honest
arrangement: asserting a type before its handler exists would fail the boot of every intermediate
commit, and a placeholder handler would defeat the assertion. `REFUND` stays out until Phase 13.

### 8. Purchase orders keep working

- `procurement.service.ts` needs no logic change.
- The route that decides is the generic one; the console's `ApprovalPanel` keeps calling
  `/api/approvals/:id/decide`.
- `submitOrder`'s approval request now defaults `deciderRole: 'ADMIN'` — unchanged behaviour.

### 9. Tests

`approvals.test.ts` (rewritten around the new rule):

- admin decides an admin row in another branch → 200;
- manager decides an admin-authority row in their branch → 403;
- manager decides a manager-authority row in their own branch → 200 (fixture: insert a row with
  `deciderRole: 'MANAGER'`, `deciderBranchId` = that branch);
- manager decides the same row from another branch → 403;
- the requester decides their own request, as admin **and** as manager → 403;
- a decided row → 409;
- rejection without a reason → 400;
- withdrawal by the requester → `WITHDRAWN`; by anyone else → 403;
- a row with `deciderRole: 'MANAGER'` and `deciderBranchId: null` cannot be created (500).

`approvals.api.test.ts`:

- 401 unauthenticated; 403 cashier; 200 admin; 200 manager on `GET /api/approvals`;
- 403 manager on `/decide` when the row is admin-authority;
- 403 manager filtering `?branchId=<foreign>`;
- `GET /api/approvals/summary` is not shadowed by `/:id` (200, not 400);
- list `sort=oldest` returns ascending `requestedAt`; `sort=newest` descending;
- `entityId` filter returns one row.

`approvals.registry.test.ts` (new, cheap): `registeredDecisionTypes()` and
`registeredSubjectTypes()` equal the boot list; an unregistered type at decision time is a 500.

## Verification

```bash
bun run --filter api test
bun run check-types
bun run lint
```

Expected: the Phase 11 approvals and procurement tests pass with only the permission-name and
authority-fixture edits named in the commit body. `grep -rn "procurement.approve" api/ admin/`
returns nothing. API suite grows by ~18.

## Commits

1. `feat(api): per-row approval authority with decider branch`
2. `feat(api): approval subject registry and richer subjects`
3. `feat(api): inbox ordering, entity filter and pending summary`
4. `refactor(api): approval routes move to approval.read and approval.decide`
5. `test(api): authority matrix, inbox scoping and summary`

## Done when

- One function decides who may decide, and the console reads the same answer from `canDecide`.
- A source-branch manager can see and decide a request raised at the destination.
- The inbox is oldest-first by default and can be filtered by type, status, branch and entity.
- A request with no handler or no subject loader fails at boot, not at the first click.
