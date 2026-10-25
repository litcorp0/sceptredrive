---
phase: 11-procurement-replenishment
plan: 03
title: Approvals core, threshold resolution, product submission
lane: api
depends_on: [02]
requirements: [PROC-02, MGR-02]
---

# Plan 03 — The decision, and the one thing a manager may propose

## Goal

One approval entity answers *who may decide what, and on what evidence* — and it is shared with
Phase 12 from the start. This plan builds the entity's lifecycle, the branch-scoped threshold
lookup, and the first decision handler: a manager-submitted product that exists only after an
admin approves it.

Plan 04 registers the second handler (purchase orders) into the same registry. Nothing else in
the phase decides anything.

## Read first

- `00-DECISIONS.md` P11-D5, P11-D6, P11-D7, P11-D14, P11-D17, P11-D18.
- `packages/shared/src/approvals.ts` (Plan 01).
- `api/src/modules/platform/settings.service.ts:65-73` — `getSettingValue` and its branch option.
- `api/src/modules/products/products.service.ts:131-212` — `suggestSku`, `createProduct`.
- `api/src/modules/products/products.validation.ts` — the create schema and `.strict()` style.
- `api/src/http/authorize.ts`, `api/src/http/session.ts`, `api/src/http/audit-context.ts`.
- `api/src/modules/payables/payables.service.ts:161-164` — idempotency replay shape.

## Tasks

### 1. `approvals.repository.ts`

Data access only:

```ts
insertApproval(values, executor)
findApprovalById(id, executor)
lockApprovalForUpdate(id, executor)                  // .for('update')
findPendingApprovalForEntity(type, entityId, executor)
selectApprovalPage(filters: { type?, status?, branchId?, limit, offset })
countApprovals(filters)
updateApprovalDecision(id, patch, executor)
withdrawApprovalRow(id, { withdrawnAt }, executor)   // status = WITHDRAWN
pointApprovalAtEntity(id, entityId, executor)        // after PRODUCT_CREATE creates the row
```

### 2. `approvals.service.ts` — request, decide, withdraw

```ts
export interface ApprovalRequestInput {
  type: ApprovalType
  entityId?: string | null
  branchId: string
  amountMinor?: number | null
  payload?: Record<string, unknown>
  note?: string | null
}

/** Internal seam: called inside the caller's transaction. Returns the new approval. */
export async function requestApproval(
  actor: AuditActor, input: ApprovalRequestInput, executor: DbExecutor,
): Promise<ApprovalRow>

export async function resolveApprovalThreshold(
  branchId: string, executor: DbExecutor,
): Promise<{ thresholdMinor: number; source: 'branch' | 'global' | 'default' }>

export async function decideApproval(
  user: SessionUser, actor: AuditActor, approvalId: string,
  input: { decision: 'APPROVED' | 'REJECTED'; reasonCode?: ApprovalReasonCode; note?: string },
): Promise<ApprovalDetail>

export async function withdrawApproval(user, actor, approvalId): Promise<ApprovalRow>
export async function listApprovals(user, query): Promise<ApprovalList>
export async function getApproval(user, approvalId): Promise<ApprovalDetail>
```

`decideApproval` — inside one `db.transaction`:

1. `lockApprovalForUpdate`; unknown id → 404.
2. `status !== 'PENDING'` → **409** `AppError('CONFLICT', 'This request has already been decided')`.
3. `assertBranchAccess(user, approval.branchId)` → 403 for a foreign branch (P11-D17).
4. `if (approval.requestedBy === actorLabel(actor)) throw ForbiddenError('You cannot decide your own request')`.
   P11-D18 makes this unreachable for purchase orders by construction; it is enforced anyway so
   no future request type can open the hole.
5. `REJECTED` without a `reasonCode` → **400**. `APPROVED` never requires one.
6. Dispatch to the handler for `approval.type` (below) **before** writing the decision, so a
   handler failure rolls the whole decision back.
7. `updateApprovalDecision`, then `writeAudit({ action: 'approval.decided', entity: 'approval',
   entityId, branchId, before: { status: 'PENDING' }, after: { status, reasonCode } })`.

Reads: `listApprovals` applies `resolveBranchFilter(user, query.branchId)`; a manager sees only
their branch and only types they can act on (`PURCHASE_ORDER`/`PRODUCT_CREATE` today, by the
`procurement.read` permission on the route).

### 3. The decision-handler registry

```ts
type DecisionHandler = (
  tx: DbTransaction,
  approval: ApprovalRow,
  actor: AuditActor,
  decision: 'APPROVED' | 'REJECTED',
  input: { reasonCode?: ApprovalReasonCode; note?: string },
) => Promise<{ entityId?: string } | void>

const HANDLERS = new Map<ApprovalType, DecisionHandler>()

/** Called at module load by the owning service. One direction only: no cycle. */
export function registerDecisionHandler(type: ApprovalType, handler: DecisionHandler): void

/** Fails fast at boot if a type that can be requested has no handler. */
export function assertDecisionHandlersRegistered(required: readonly ApprovalType[]): void
```

This module self-registers `PRODUCT_CREATE` (its handler lives in this file). Plan 04 calls
`registerDecisionHandler('PURCHASE_ORDER', …)` from `procurement.service.ts`, so the import runs
`procurement → approvals` and never the reverse. That direction is the whole reason for a registry
instead of a `switch`.

An unregistered type at decision time → `AppError(500, 'INTERNAL', …)`. A request type that cannot
be decided is a programming error, not a user error, and it must be visible in tests the first
time somebody adds one.

### 4. `PRODUCT_CREATE` — submission and approval (MGR-02, P11-D7)

**Submit** — `POST /api/products/submissions`, permission `procurement.create` (P11-D21):

```ts
// products.validation.ts
export const productSubmissionSchema = z.object({
  name: z.string().trim().min(2).max(120),
  categoryId: z.uuid(),
  uomId: z.uuid(),
  brandId: z.uuid().optional(),
  description: z.string().trim().max(500).optional(),
  proposedBasePriceMinor: z.number().int().min(1).max(100_000_000_000),
  barcode: z.string().trim().min(6).max(64).optional(),
  supplierId: z.uuid().optional(),
  note: z.string().trim().max(300).optional(),
}).strict()
```

Service (`products.service.ts`):

```ts
export async function submitProduct(
  user: SessionUser, actor: AuditActor, input: ProductSubmissionBody,
): Promise<{ approvalId: string; status: 'PENDING' }>
```

- Validate that the category, unit and brand exist and are active, and the supplier is `ACTIVE`
  (`requireSupplier`). A submission that names a dead referent is a 400 at submit, not a
  surprise at approval.
- Create the approval with `payload` = the validated submission and
  `amountMinor = proposedBasePriceMinor`.
- Audit `product.submitted`.
- **No product row is created here.** Re-submitting the same product while a request is pending
  is allowed (they are different proposals); the partial unique index in Plan 02 only guards
  `entity_id IS NOT NULL`, which a pending submission does not have.

**Approve** — `productCreateHandler`:

- `APPROVED`: call `createProductFromSubmission(tx, actor, approval.payload)`:
  - allocate the SKU through `allocateFromSequence('catalog.skuSequence', tx)` (or accept the
    submitted barcode as an additional barcode);
  - insert the product with `basePriceMinor = proposedBasePriceMinor`,
    `costPriceMinor = 0` (P11-D13: cost is derived from receipts, never typed);
  - insert the barcode when supplied, rejecting a duplicate with 409;
  - audit `product.created` with `{ via: 'approval', approvalId }`;
  - `pointApprovalAtEntity(approval.id, product.id, tx)`.
- `REJECTED`: touch nothing. The payload stays on the approval as the record of what was asked.

The payload is re-validated with `productSubmissionSchema` at approval time. A payload that no
longer validates (e.g. the category was archived between submit and approve) fails the decision
with a 409 that names the field — the admin then rejects with a reason. That is the honest
outcome; silently creating a product in an archived category is not.

### 5. Routes

`approvals.routes.ts`:

| Method | Path | Permission |
|---|---|---|
| GET | `/api/approvals` | `procurement.read` |
| GET | `/api/approvals/:id` | `procurement.read` |
| POST | `/api/approvals/:id/decide` | `procurement.approve` |
| POST | `/api/approvals/:id/withdraw` | `procurement.read` + requester check in the service |

`products.routes.ts` gains:

| Method | Path | Permission |
|---|---|---|
| POST | `/api/products/submissions` | `catalog.create` |

Controller handlers take validated input and call exactly one service function, per `AGENTS.md`.
No controller imports a repository.

### 6. Types

`approvals.types.ts` — `ApprovalRow`, `ApprovalDetail` (`{ approval, thresholds }` for a PO;
`{ approval, product? }` for a product), `ApprovalList`, and the zod-inferred input aliases.
`ApprovalDetail` always includes `canDecide: boolean` computed server-side from the actor's
permissions and identity, so the console does not re-implement the rule.

### 7. Tests

`approvals.test.ts` (service, real database):

- below threshold → no approval is created (this plan proves the *absence*; Plan 04 proves the
  PO side);
- at exactly the threshold and one pesewa above → approval created with `amountMinor` equal to
  the goods value;
- decide as a different admin → `APPROVED`, `decided_at` set, audit present;
- decide twice → 409, second attempt changes nothing;
- decide a foreign branch as a manager → 403 (manager has no `procurement.approve`, so this is
  proven at the route level in `approvals.api.test.ts`);
- requester decides own request → 403 (reachable here by submitting a product and deciding it as
  the same admin);
- reject without a reason → 400; with a reason → 200 and `REJECTED`;
- withdraw by requester → `WITHDRAWN`; withdraw by another user → 403.

`api/src/modules/products/products.test.ts` gains:

- submit → approval row `PENDING`, **zero** product rows with that name;
- approve → one product, `basePriceMinor` equals the proposed price, `costPriceMinor === 0`,
  SKU allocated, approval `entityId` now set;
- reject → still zero products, approval carries the payload;
- approve twice → 409 and still one product.

`approvals.api.test.ts`: the route-level matrix — 401 unauthenticated, 403 for a cashier, 403 for
a manager hitting `/decide`, 200 for an admin, and 403 for a manager reading another branch's
approval list filtered by `branchId`.

## Verification

```bash
bun run --filter api test
bun run check-types
bun run lint
```

Expected: API suite grows by ~25 and every existing test passes unedited. `grep -rn "createProduct("
api/src` shows the only callers are the existing catalog route, the seed, and
`createProductFromSubmission`.

## Commits

1. `feat(api): approvals entity with a decision registry`
2. `feat(api): branch-scoped approval threshold resolution`
3. `feat(api): manager product submission approved by an admin`
4. `test(api): approval lifecycle, self-approval and one-shot decisions`

## Done when

- An approval can be requested, listed, read, decided once, and withdrawn by its requester.
- A decision is atomic: the handler and the status change commit or roll back together.
- A manager-submitted product does not exist until an admin approves it.
- Self-approval has no successful path, proven by a test rather than by a comment.
- The threshold is read per branch and falls back to GHS 10,000 when unset.
