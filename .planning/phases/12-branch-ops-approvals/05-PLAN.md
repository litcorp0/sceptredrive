---
phase: 12-branch-ops-approvals
plan: 05
title: Stock write-offs — the document, the decision, the posted WRITE_OFF movement
lane: api
depends_on: [03, 04]
requirements: [BRN-02, APR-01, APR-02, APR-04, MGR-04]
---

# Plan 05 — Damaged stock has a form, and the form has an approver

## Goal

A manager can report what is broken, expired, obsolete, stolen or returned by a supplier, with a
reason per line and a value frozen at the moment of asking. Only an admin's approval posts the
negative movement — and the direct adjustment path can no longer be used to route around it.

## Read first

- `00-DECISIONS.md` P12-D13 … P12-D17.
- `01-RESEARCH.md` §3 items 17–19.
- `api/src/modules/inventory/inventory.service.ts:114-192,438-492` — `postMovements` and
  `createAdjustment` (the path this plan narrows).
- `api/src/modules/counts/counts.service.ts:191-274` — the negative-stock pre-check shape.
- `api/src/modules/procurement/` — the seven-file module layout and the document pattern.
- `api/src/modules/platform/sequences.service.ts` (Plan 02) — `allocateDocumentNumber`.
- `api/src/modules/approvals/approvals.service.ts` (Plan 03).

## Tasks

### 1. The module's six remaining files

`api/src/modules/writeoffs/` — `writeoffs.schema.ts` exists from Plan 02.

**`writeoffs.validation.ts`**

```ts
const writeOffLineSchema = z.object({
  productId: z.uuid(),
  quantity: z.number().int().min(1).max(1_000_000),
  reason: z.enum(STOCK_WRITE_OFF_REASONS),
  note: z.string().trim().max(300).optional(),
}).strict()

export const writeOffCreateSchema = z.object({
  lines: z.array(writeOffLineSchema).min(1).max(100),
  note: z.string().trim().max(300).optional(),
}).strict()
```

**`writeoffs.types.ts`** — `WriteOffRow`, `WriteOffLineRow`, `WriteOffDetail`
(`{ writeOff, lines, approval }`), `WriteOffListRow`, list query/response types.

**`writeoffs.repository.ts`** — data access only: `insertWriteOff`, `insertWriteOffLine`,
`findWriteOffById`, `lockWriteOffForUpdate`, `selectWriteOffLines`, `updateWriteOffRow`,
`selectWriteOffPage`, `countWriteOffs`, `selectWriteOffLinesForValue`.

**`writeoffs.service.ts`**

```ts
export async function createWriteOff(user, actor, input): Promise<WriteOffDetail>
export async function listWriteOffs(user, query): Promise<WriteOffListResponse>
export async function getWriteOff(user, writeOffId): Promise<WriteOffDetail>
export async function cancelWriteOff(user, actor, writeOffId): Promise<void>
```

`createWriteOff`:

1. `roleOf(user) === 'ADMIN'` → **400**, "An admin posts a negative adjustment directly; this form
   is for branch managers" (P12-D3).
2. Branch = `branchScope(user)`; resolve it through `branchesService.getBranch` and reject inactive.
3. Reject duplicate `productId` in one request; every product must exist and be active.
4. `THEFT` and `OTHER` require a line note → **400** naming the product (P12-D16).
5. Read the branch's `stock_level` rows for the products (the module's own query, including
   `avg_cost_minor`) and store `unit_cost_minor` per line; `value_minor` = Σ qty × cost
   (P12-D17).
6. Allocate the number: `allocateDocumentNumber('stock_write_off', branchId, tx)`.
7. Insert the header as `PENDING_APPROVAL` and the lines.
8. `requestApproval(actor, { type: 'STOCK_WRITE_OFF', entityId: id, branchId, amountMinor: value,
   payload: { number, lineCount, reasons }, deciderRole: 'ADMIN', deciderBranchId: null, note }, tx)`.
9. `updateWriteOffRow(id, { approvalId })`; audit `stock_write_off.requested`.

`cancelWriteOff`: only the requester, only `PENDING_APPROVAL`; withdraw the approval
(`findPendingApprovalForEntity`) and set `CANCELLED` in one transaction.

### 2. The decision handler

```ts
registerDecisionHandler('STOCK_WRITE_OFF', async (tx, approval, actor, decision, input) => {
  const writeOff = await lockWriteOffForUpdate(approval.entityId!, tx)
  if (!writeOff) throw new NotFoundError('Stock write-off not found')
  if (writeOff.status !== 'PENDING_APPROVAL') throw new ConflictError('This write-off has already moved')
  if (decision === 'REJECTED') {
    await updateWriteOffRow(writeOff.id, { status: 'REJECTED' }, tx)
    // audit only; no movement, no level change
    return
  }
  const lines = await selectWriteOffLines(writeOff.id, tx)
  await inventoryService.postMovements(actor, lines.map((line) => ({
    productId: line.productId,
    branchId: writeOff.branchId,
    type: 'WRITE_OFF' as const,
    quantityDelta: -line.quantity,
    unitCostMinor: line.unitCostMinor,
    referenceType: 'WRITE_OFF' as const,
    referenceId: writeOff.id,
    referenceNumber: writeOff.number,
    reasonCode: line.reason,          // the write-off enum, copied verbatim
    note: line.note ?? undefined,
    productName: line.productName,
  })), { executor: tx })
  await updateWriteOffRow(writeOff.id, { status: 'APPROVED', postedAt: new Date() }, tx)
  // audit stock_write_off.approved with the value and the movement ids
})
```

`postMovements` refuses negative stock without `allowNegative`; a line that would drive the level
below zero therefore fails the **decision** with a 409 and the whole thing rolls back (P12-D17). The
error message must name the product and say the request must be re-raised.

**Two reason vocabularies, one column.** The form uses `stock_write_off_reason` (its own stable
list); `stock_movement.reason_code` is `stock_adjustment_reason`, which already holds `DAMAGE`,
`LOSS`, `FOUND`, `CORRECTION`, `EXPIRED`, `OTHER`. Plan 02's enum file therefore also adds
`THEFT`, `OBSOLESCENCE` and `SUPPLIER_FAULT` to `stock_adjustment_reason`, and the handler maps
the one value that differs — `EXPIRY` → `EXPIRED` — in a single documented function:

```ts
const MOVEMENT_REASON: Record<StockWriteOffReason, StockAdjustmentReason> = {
  DAMAGE: 'DAMAGE', EXPIRY: 'EXPIRED', OBSOLESCENCE: 'OBSOLESCENCE',
  THEFT: 'THEFT', SUPPLIER_FAULT: 'SUPPLIER_FAULT', OTHER: 'OTHER',
}
```

The two lists are not merged: `EXPIRED` describes a date that passed, `EXPIRY` describes why the
goods left; keeping the form's vocabulary separate means a future reason can be added without
widening an enum the ledger already depends on.

### 3. Subject loader

```ts
registerSubjectLoader('STOCK_WRITE_OFF', async (approval) => {
  const writeOff = await findWriteOffById(approval.entityId!)
  return { kind: 'stock_write_off', writeOffId: writeOff.id, number: writeOff.number,
    lineCount: writeOff.lineCount }
})
```

The detail read returns the header, the lines (product, quantity, cost, reason, note) and the
computed value, so the admin decides with the evidence on screen.

### 4. Narrow the direct adjustment path (P12-D13)

`inventory.service.createAdjustment`, before posting:

```ts
const SHRINKAGE_REASONS = new Set(['DAMAGE', 'LOSS', 'EXPIRED', 'OTHER'])
if (roleOf(user) !== 'ADMIN' && input.quantityDelta < 0 && SHRINKAGE_REASONS.has(input.reasonCode)) {
  throw new ValidationError(
    'Shrinkage is written off through a stock write-off request. Use Inventory → Write-offs.',
  )
}
```

- Positive adjustments (`FOUND`, `CORRECTION`) stay direct for everyone.
- A negative `CORRECTION` stays direct (it is a data fix, not a loss) — document that in the code
  comment, because it is the one remaining hole and the reason it is acceptable: it requires the
  manager to call a correction a correction, and the audit row records it.
- Admins keep the direct path.

### 5. Routes and mount

| Method | Path | Permission |
|---|---|---|
| POST | `/api/write-offs` | `inventory.adjust` |
| GET | `/api/write-offs` | `inventory.read` |
| GET | `/api/write-offs/:id` | `inventory.read` |
| POST | `/api/write-offs/:id/cancel` | `inventory.adjust` |

`api/src/app.ts` mounts `writeOffsRoutes` and registers the `STOCK_WRITE_OFF` handler/loader by
importing the service module (the import is what registers it). This is the one `app.ts` edit this
plan makes; Plan 10 makes the other.

### 6. Tests (`writeoffs.test.ts`, real database)

- create → `PENDING_APPROVAL`, one `PENDING` approval, **zero** `stock_movement` rows for the
  write-off;
- value: 3 units at a level whose `avg_cost_minor` is 500 → header `value_minor = 1500`, lines
  carry 500;
- approve → movements of type `WRITE_OFF`, `reference_type = 'WRITE_OFF'`, `quantity_delta` = −3,
  `unit_cost_minor` = 500, and `stock_level.quantity_on_hand` drops by 3;
- Σ `stock_movement.quantity_delta` for the branch = `quantity_on_hand` after the approval
  (reconciliation);
- reject → status `REJECTED`, **zero** movements, level unchanged;
- approve when the level would go negative → 409, status still `PENDING_APPROVAL`, no movement;
- `THEFT` without a note → 400; with a note → 201;
- admin calling create → 400; manager posting a direct negative `DAMAGE` adjustment → 400; admin
  posting the same → 200 (the guard is a role rule, not a data rule);
- another branch's manager reading the write-off → 403; cancelling someone else's → 403;
- a decided write-off cannot be cancelled → 409.

## Verification

```bash
bun run --filter api test
bun run check-types
bun run lint
```

Expected: API grows by ~20. The existing `inventory.test.ts` adjustment cases for `DAMAGE` by a
manager are updated to the new rule and the edit is named in the commit body.

## Commits

1. `feat(api): stock write-off document with per-line reasons`
2. `feat(api): approved write-off posts a WRITE_OFF movement`
3. `feat(api): managers route shrinkage through write-offs`
4. `test(api): write-off value, rejection and ledger reconciliation`

## Done when

- No manager-reachable path reduces stock for damage, loss, expiry or theft without an approval.
- The approved value and the ledger value are the same number.
- A rejection leaves the level and the ledger byte-identical.
