---
phase: 11-procurement-replenishment
plan: 04
title: Purchase order lifecycle
lane: api
depends_on: [03]
requirements: [PROC-01, PROC-02, PROC-08, MGR-03]
---

# Plan 04 — One document a manager can reason about

## Goal

A manager raises an order for their branch, submits it, and either it goes straight through or it
waits for an admin; the admin decides; the approved order is sent and printed. Once approved, the
order's lines and prices are immutable — a change is a new document, never an edit.

This plan also registers the `PURCHASE_ORDER` decision handler, which is the only edit it makes
outside `procurement/**`.

## Read first

- `00-DECISIONS.md` P11-D2, P11-D6, P11-D18, P11-D19, P11-D20.
- `packages/shared/src/procurement.ts` — the transition table this service enforces.
- `api/src/modules/payables/payables.service.ts:135-356` — the transaction shape to mirror
  (branch resolution, idempotency before and inside the tx, numbering, audit in the tx,
  unique-violation disambiguation with `uniqueViolationConstraint`).
- `api/src/modules/payables/payables.repository.ts:54-120` — insert/lock/list selection style.
- `api/src/modules/inventory/inventory.service.ts:241-260` — `requireActiveProduct` /
  `requireActiveBranch` helpers to copy.
- `api/src/modules/suppliers/suppliers.service.ts:230-250` — `requireSupplier`, `lockSupplier`.

## Tasks

### 1. `procurement.repository.ts` — order half

```ts
insertOrder(values, executor)
insertOrderLines(values, executor)
deleteOrderLines(orderId, executor)                     // DRAFT only, guarded in the service
findOrderById(id, executor)
lockOrderForUpdate(id, executor)
findOrderByIdempotency(branchId, key, executor)
updateOrderRow(id, patch, executor)
selectOrderPage(filters) / countOrders(filters)
selectOrderLines(orderId, executor)                      // joins product sku/name
selectReceivedByOrderLine(orderId, executor)             // Σ stock_receipt_line.quantity
selectOpenOrderLineQuantity(productId, branchId, executor)  // D9, used by Plan 08
selectOrderDetailHeader(id, executor)
```

`selectReceivedByOrderLine` is the only place "received" is defined; Plan 05 and Plan 08 both call
it. It is a `left join stock_receipt_line` on `purchase_order_line_id`, `coalesce(sum(...), 0)`,
`.mapWith(Number)`.

### 2. `procurement.validation.ts` — order inputs

```ts
const orderLineSchema = z.object({
  productId: z.uuid(),
  quantity: z.number().int().min(1).max(1_000_000),
  unitCostMinor: z.number().int().min(0).max(100_000_000_000),
}).strict()

export const orderCreateSchema = z.object({
  branchId: z.uuid(),
  supplierId: z.uuid(),
  expectedDate: z.iso.date().optional(),
  note: z.string().trim().max(300).optional(),
  idempotencyKey: z.uuid(),
  lines: z.array(orderLineSchema).min(1).max(100),
}).strict().refine(noDuplicateProducts)

export const orderUpdateSchema = z.object({ …same minus branchId/idempotencyKey, lines optional })
export const orderListQuerySchema = z.object({
  branchId: z.uuid().optional(),
  supplierId: z.uuid().optional(),
  status: z.enum([...]).optional(),
  q: z.string().trim().min(2).max(120).optional(),   // order number or supplier name
  limit, offset,
})
export const orderActionSchema = z.object({ note: z.string().trim().max(300).optional() }).strict()
export const cancelSchema = z.object({ reason: z.string().trim().min(3).max(300) }).strict()
```

Validators exported as `validateOrderCreate`, `validateOrderUpdate`, `validateOrderListQuery`,
`validateOrderIdParam`, `validateOrderCancel`, `validateOrderClose`.

### 3. `procurement.service.ts` — order half

```ts
export async function createOrder(user, actor, input): Promise<OrderDetail>
export async function updateOrder(user, actor, orderId, input): Promise<OrderDetail>
export async function submitOrder(user, actor, orderId): Promise<OrderDetail>
export async function sendOrder(user, actor, orderId): Promise<OrderDetail>
export async function cancelOrder(user, actor, orderId, reason): Promise<OrderDetail>
export async function closeOrder(user, actor, orderId, note?): Promise<OrderDetail>
export async function listOrders(user, query): Promise<OrderList>
export async function getOrder(user, orderId): Promise<OrderDetail>
```

**`createOrder`**

1. `branchId = input.branchId`; `assertBranchAccess(user, branchId)`; branch must exist, be active,
   and be `RETAIL` or `WAREHOUSE` (both may hold stock; only retail sells — irrelevant here but the
   active check is not).
2. Idempotency replay before the transaction, and again inside it (`findOrderByIdempotency`).
3. `requireSupplier(input.supplierId)`; every product must exist and be active.
4. Transaction: `allocateDocumentNumber('purchase_order', branchId, tx)` → insert order (`DRAFT`,
   `requestedBy = actorLabel(actor)`) → insert lines → `writeAudit('purchase_order.created')`.
5. Return `getOrder` shaped detail, including `goodsValueMinor`.

**`updateOrder`** — `DRAFT` only, else **409** `An approved order cannot be changed`. Replace the
whole line set (`deleteOrderLines` + `insertOrderLines`); this is the **only delete path in this
phase** and it can never touch a ledger because a draft has no receipt, no movement and no
approval. Audit `purchase_order.updated` with before/after line counts and the goods value delta.

**`submitOrder`** — the heart of PROC-02:

1. Lock the order; status must be `DRAFT` (`canApplyOrderAction`), else 409.
2. `goodsValueMinor` is computed from the lines **inside** the transaction (not trusted from the
   client) and must be `> 0`.
3. `const { thresholdMinor, source } = await resolveApprovalThreshold(order.branchId, tx)`.
4. Branch resolution:
   - `roleOf(user) === 'ADMIN'` → **auto-approve**, reason `ADMIN_REQUEST` (P11-D18);
   - else `requiresApproval(value, threshold)` → create an `approval` row
     (`type: 'PURCHASE_ORDER'`, `entityId: order.id`, `amountMinor: value`), set
     `status = PENDING_APPROVAL`, `approvalId`;
   - else → **auto-approve**, reason `THRESHOLD`.
5. Auto-approve writes `status = APPROVED`, `approved_at = now()`, `submitted_at = now()` and
   `writeAudit({ action: 'purchase_order.auto_approved', after: { value, thresholdMinor, source,
   reason } })`. **No approval row** (P11-D6).
6. Pending writes `submitted_at` and audits `purchase_order.submitted`.

**`sendOrder`** — status `APPROVED` → `SENT`, sets `sent_at`/`sent_by`. Re-sending a `SENT` order
is a no-op 200 (the print sheet can be reopened) but does not move the timestamp.

**`cancelOrder`** — allowed from `DRAFT`, `PENDING_APPROVAL`, `APPROVED`, and `SENT` **with zero
received quantity** (checked with `selectReceivedByOrderLine`); otherwise **409** `Goods have been
received against this order`. A pending approval is withdrawn in the same transaction.

**`closeOrder`** — from `APPROVED`, `SENT`, `PARTIALLY_RECEIVED`, `RECEIVED` → `CLOSED`, with an
optional note. This is the short-close: outstanding quantity is abandoned on the order, **not**
on stock and **not** on the supplier. Audit `purchase_order.closed` with the outstanding quantity
per line, so the number is recoverable after the screen forgets it.

**`getOrder`** returns:

```ts
{
  order: { id, number, status, branchId, supplierId, supplierName, expectedDate, note,
           requestedBy, submittedAt, approvedAt, sentAt, closedAt, cancelledAt, closeNote,
           cancelReason, approvalId },
  lines: [{ id, lineNumber, productId, sku, name, quantity, unitCostMinor, lineTotalMinor,
            receivedQuantity, outstandingQuantity }],
  goodsValueMinor,
  threshold: { valueMinor, source },
  approval: ApprovalSummary | null,
  canApply: { submit, send, cancel, close, receive },   // computed for this actor
}
```

`canApply` is computed server-side from the shared transition table **and** the actor's
permissions, so the console never re-derives a rule.

### 4. Register the `PURCHASE_ORDER` decision handler

`approvals.service.ts` already owns the registry (Plan 03). Add, in `procurement.service.ts`:

```ts
registerDecisionHandler('PURCHASE_ORDER', async (tx, approval, actor, decision, input) => {
  const order = await lockOrderForUpdate(approval.entityId, tx)
  if (order.status !== 'PENDING_APPROVAL') throw conflict('already moved')
  const status = decision === 'APPROVED' ? 'APPROVED' : 'REJECTED'
  await updateOrderRow(order.id, { status,
    approvedAt: decision === 'APPROVED' ? new Date() : null,
    rejectedAt: decision === 'REJECTED' ? new Date() : null }, tx)
  await writeAudit({ action: `purchase_order.${status.toLowerCase()}`, entity: 'purchase_order',
    entityId: order.id, branchId: order.branchId,
    after: { approvalId: approval.id, reasonCode: input.reasonCode ?? null } }, tx)
})
```

**The import direction is one-way:** `procurement.service` imports `approvals.service`, never the
reverse. That is why the registry exists instead of a `switch` in the approvals service. A test
imports both modules and asserts the registry is populated —
`assertDecisionHandlersRegistered(['PURCHASE_ORDER', 'PRODUCT_CREATE'])`, called from
`api/src/app.ts` at module load, fails fast if a writable type has no handler.

### 5. Routes

`procurement.routes.ts`:

| Method | Path | Permission |
|---|---|---|
| GET | `/api/procurement/orders` | `procurement.read` |
| POST | `/api/procurement/orders` | `procurement.create` |
| GET | `/api/procurement/orders/:id` | `procurement.read` |
| PATCH | `/api/procurement/orders/:id` | `procurement.create` |
| POST | `/api/procurement/orders/:id/submit` | `procurement.create` |
| POST | `/api/procurement/orders/:id/send` | `procurement.create` |
| POST | `/api/procurement/orders/:id/cancel` | `procurement.create` |
| POST | `/api/procurement/orders/:id/close` | `procurement.create` |

Every handler resolves the order through `getOrder(user, id)`, which applies
`assertBranchAccess`. A foreign id is a **403**, never a silent empty response (P11-D17).

### 6. Tests

`procurement.test.ts` (service):

- create → number matches `/^PO-[A-Z0-9]+-\d{6}-\d{4}$/`, status `DRAFT`, goods value correct;
- duplicate `idempotencyKey` → same order, `replayed: true`, one row;
- duplicate product in one order → 400 from validation;
- edit a draft replaces lines; edit an approved order → 409;
- **threshold matrix**, manager actor:

  | Goods value | Result |
  |---|---|
  | 999_999 | `APPROVED`, no approval row, audit `auto_approved` reason `THRESHOLD` |
  | 1_000_000 | `PENDING_APPROVAL`, approval row `amountMinor = 1_000_000` |
  | 1_000_001 | `PENDING_APPROVAL` |
  | branch override 500_000, value 600_000 | `PENDING_APPROVAL` (branch setting wins) |

- admin actor at 5_000_000 → `APPROVED`, reason `ADMIN_REQUEST`, no approval row;
- approve via `decideApproval` → order `APPROVED`; reject → `REJECTED`; a rejected order cannot
  be sent or edited (409);
- send → `SENT` with `sentAt`; sending twice does not move `sentAt`;
- cancel a draft and a pending order → `CANCELLED` + approval `WITHDRAWN`;
- close a sent order with no receipts → `CLOSED` with an audit entry carrying outstanding qty.

`procurement.api.test.ts` (HTTP): 401 unauthenticated; 403 for a cashier; 200 for a manager on
their own branch; **403 for a manager on another branch's order id and on `branchId` in the list**
(P11-D17's IDOR legs, first instalment); 400 for a body with an extra field (`.strict()`).

## Verification

```bash
bun run --filter api test
bun run check-types
bun run lint
```

And confirm the numbers in the database, not only the response:

```sql
SELECT number, status, approval_id FROM purchase_order ORDER BY created_at DESC LIMIT 5;
SELECT count(*) FROM approval WHERE type = 'PURCHASE_ORDER' AND status = 'PENDING';
SELECT action, after FROM audit_log WHERE entity = 'purchase_order'
 ORDER BY created_at DESC LIMIT 10;
```

## Commits

1. `feat(api): purchase order schema, validation and repository`
2. `feat(api): draft orders, editing and document numbering`
3. `feat(api): submit with threshold-based approval and admin auto-approval`
4. `feat(api): send, cancel and short-close`
5. `feat(api): the purchase order decision handler`
6. `test(api): the threshold matrix and order immutability`

## Done when

- A manager can raise, edit, submit, cancel and short-close an order for their own branch, and
  cannot for any other.
- The threshold decision is branch-scoped, computed from the lines inside the transaction, and
  proven at the boundary.
- An admin-raised order never needs a second admin, and no approval row exists for it.
- An approved order cannot be edited — the only recourse is cancel and re-raise.
- `canApply` comes from the server, so the console and the API cannot disagree about what is
  allowed next.
