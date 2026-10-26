---
phase: 12-branch-ops-approvals
plan: 04
title: Transfer requests — request, decide, dispatch guard, withdraw
lane: api
depends_on: [03]
requirements: [BRN-01, APR-01, APR-02, APR-04, MGR-05]
---

# Plan 04 — A transfer nobody can dispatch alone

## Goal

The branch that needs stock asks for it, the branch that holds it agrees, and nothing moves until
that agreement exists. The existing dispatch → receive → short-close path is untouched, so every
Phase 3 guarantee (no negative stock, partial receive, discrepancy) still holds.

## Read first

- `00-DECISIONS.md` P12-D9 … P12-D12.
- `api/src/modules/transfers/transfers.service.ts` — all of it (551 lines).
- `api/src/modules/transfers/transfers.validation.ts`, `.routes.ts`, `.types.ts`, `.repository.ts`.
- `api/src/modules/inventory/inventory.service.ts:114-192` (`postMovements`) and
  `inventory.repository.ts:84-96` (`findLevel`).
- `api/src/modules/approvals/approvals.service.ts` (Plan 03) — `requestApproval`,
  `registerDecisionHandler`, `registerSubjectLoader`, `withdrawApprovalRow` usage in
  `procurement.service.ts:773-780`.
- `api/src/modules/org/branches.service.ts` — `getBranch` returns `type`.

## Tasks

### 1. One read the transfer service needs

`transfers.repository.ts` already has `selectLevelsForProducts(branchId, productIds)` returning
`Map<productId, quantityOnHand>` (`transfers.repository.ts:240-254`), used by `loadDetail` to show
on-hand at both branches. Extend it to return the average cost as well:

```ts
selectLevelsForProducts(branchId, productIds, executor = db):
  Promise<Map<string, { quantityOnHand: number; avgCostMinor: number }>>
```

Update the two `loadDetail` call sites (`transfers.service.ts:82-83`). The request valuation then
reads the source branch's cost from the same query the detail already runs — no new cross-module
call, and no second definition of "the level at a branch".

Plan 05's write-off module reads the same projection in its own repository, following the
replenishment module's precedent (a module may read another module's projection; it may not write
it — the write goes through `postMovements`).

### 2. `createTransfer` branches on role (P12-D10)

| Actor | Status | Approval | `to` branch |
|---|---|---|---|
| `MANAGER` | `REQUESTED` | `TRANSFER_REQUEST`, created in the same transaction | **must** be the manager's branch |
| `ADMIN` | `DRAFT` | none | any active branch |

- A manager whose `toBranchId` is not their own gets a **403**: "A transfer request is raised by the
  destination branch."
- An admin creating a request is refused at the service (P12-D3) — the console does not offer it,
  and the API must not accept it. The admin path is a draft.
- Existing guards stay: distinct active branches, active products, unique lines, `quantity > 0`.
- `amountMinor` = Σ `quantityRequested × source avgCostMinor` from `getLevelsForProducts`; a line
  whose product has no level at the source values at 0 (the transfer will fail at dispatch on
  stock, which is the honest place to fail).
- `requestApproval` is called with `deciderRole: 'MANAGER'`, `deciderBranchId: source.id` when
  `source.type === 'RETAIL'`, and `deciderRole: 'ADMIN'`, `deciderBranchId: null` when the source
  is a `WAREHOUSE` (P12-D11). `payload` = `{ fromBranchId, toBranchId, fromBranchType, lineCount }`.
- Audit `transfer.created` with `after: { status, approvalId }` in the same transaction.

The number is still allocated at creation (`inventory.transferSequence`), so a request has a
reference the source manager can quote.

### 3. Decision handler

`transfers.service.ts` registers at module load:

```ts
registerDecisionHandler('TRANSFER_REQUEST', async (tx, approval, actor, decision, input) => {
  if (!approval.entityId) throw new AppError(500, 'INTERNAL', 'A transfer approval has no transfer')
  const transfer = await lockTransferForUpdate(approval.entityId, tx)
  if (!transfer) throw new NotFoundError('Transfer not found')
  if (transfer.status !== 'REQUESTED') throw new ConflictError('This transfer has already moved')
  const status: TransferStatus = decision === 'APPROVED' ? 'APPROVED' : 'REJECTED'
  await updateTransferRow(transfer.id, { status }, tx)
  await writeAudit({ ...actor, action: `transfer.${status.toLowerCase()}`, entity: 'transfer',
    entityId: transfer.id, branchId: transfer.toBranchId,
    before: { status: 'REQUESTED' }, after: { status, approvalId: approval.id,
    reasonCode: input.reasonCode ?? null } }, tx)
})
```

`REJECTED` posts no movement, touches no level, and is terminal. The handler runs before the status
change, so a failure rolls the decision back (Phase 11's rule).

### 4. Subject loader

```ts
registerSubjectLoader('TRANSFER_REQUEST', async (approval) => {
  const transfer = await findTransferById(approval.entityId!)
  return { kind: 'transfer', transferId: transfer.id, fromBranchId: transfer.fromBranchId,
    toBranchId: transfer.toBranchId, lineCount: transfer.lines.length }
})
```

The inbox detail also returns the transfer (with lines, products and quantities) through the
subject arm; the decision screen needs to show **what** is being asked for, not just that something
is.

### 5. Guards on the existing transitions

| Function | Change |
|---|---|
| `dispatchTransfer` | accept `status === 'APPROVED'` **or** `'DRAFT'`; `REQUESTED` and `REJECTED` are a **409** naming the status |
| `cancelTransfer` | accept `DRAFT` or `REQUESTED`; when `REQUESTED`, call `withdrawPendingApproval(transfer.approvalId, tx)` inside the same transaction so the queue empties |
| `updateTransfer` / `replaceTransferLines` | unchanged (`DRAFT` only) — a request's lines are frozen |
| `receiveTransfer` / `shortCloseTransfer` | unchanged |

`transfer` has no `approval_id` column; the approval points at the transfer through `entityId`.
`cancelTransfer` therefore looks the pending approval up by
`findPendingApprovalForEntity('TRANSFER_REQUEST', transferId, tx)`.

### 6. Types, validation, routes

- `TransferDetail` gains `approval: { id, status, requestedBy, decidedBy, decidedAt,
  decisionReasonCode } | null` and `canDispatch: boolean` computed server-side (status is
  `DRAFT`/`APPROVED` and the actor is the source branch), so the console never guesses.
- `transferCreateSchema` is unchanged; the destination rule is authority, not shape.
- Routes are unchanged: `POST /api/transfers` (`inventory.transfer`), `POST /api/transfers/:id/
  dispatch`, `/receive`, `/short-close`, `/cancel`. Decisions go through `/api/approvals/:id/decide`.

### 7. Tests (`transfers.test.ts`)

- manager creates a request with `toBranchId` = own branch → `REQUESTED`, one `PENDING` approval
  with `deciderRole = 'MANAGER'` and `deciderBranchId` = source, `amountMinor` = hand-computed
  Σ qty × avg cost;
- manager creates with `toBranchId` = another branch → **403**;
- manager creates a `DRAFT` → **403** (status is never `DRAFT` for a manager);
- admin creates → `DRAFT`, **zero** approval rows;
- dispatch a `REQUESTED` transfer → **409** and the source level is unchanged;
- source manager approves → `APPROVED`; dispatch now succeeds and the source level drops by
  exactly the dispatched quantity (ledger reconciliation);
- source manager rejects → `REJECTED`; dispatch → 409; **no** `stock_movement` row exists for the
  transfer (`SELECT count(*) … WHERE reference_id = transferId` = 0);
- warehouse → branch request: `deciderRole = 'ADMIN'`, a manager cannot decide it (403), an admin
  can;
- requester withdraws (`POST /api/transfers/:id/cancel`) → transfer `CANCELLED`, approval
  `WITHDRAWN`, no movement;
- a third branch's manager reads the transfer detail → 403 (IDOR);
- receiving a partially dispatched approved transfer still produces `SHORT_CLOSED` on short-close.

## Verification

```bash
bun run --filter api test
bun run check-types
bun run lint
```

Expected: API grows by ~16; every Phase 3 transfer test passes with only the fixtures that created
a manager transfer now going through `REQUESTED` → approve. `git diff --stat -- desktop/
powersync/` is empty.

## Commits

1. `feat(api): transfer requests raised by the destination branch`
2. `feat(api): transfer authority by source branch type`
3. `feat(api): dispatch requires an approved request`
4. `test(api): transfer request lifecycle, rejection and IDOR`

## Done when

- A manager cannot move stock between branches without a second person's decision.
- A rejected request leaves the ledger byte-identical.
- The source manager can see the request in their inbox without being given access to the
  destination's other work.
