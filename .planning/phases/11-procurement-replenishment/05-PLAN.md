---
phase: 11-procurement-replenishment
plan: 05
title: Receiving against an order, the supplier-product link, derived catalogue cost
lane: api
depends_on: [04]
requirements: [PROC-03, PROC-09, PROC-10, MGR-03]
---

# Plan 05 — Goods arrive

## Goal

A delivery is received against what was ordered, line by line: ordered, previously received,
received now, outstanding. A short delivery leaves the order open for a second receipt; an
over-delivery needs a reason and is recorded, never truncated. Receiving posts through the
existing stock ledger — no second write path — and the first receipt of a part creates its
supplier link and its derived cost.

## Read first

- `00-DECISIONS.md` P11-D3, P11-D11, P11-D13, P11-D19, P11-D20.
- `api/src/modules/inventory/inventory.service.ts:67-186` — `postMovements`, the validation rules,
  `averageCostAfterReceipt`, the negative-stock guard.
- `api/src/modules/inventory/inventory.service.ts:313-397` — `createReceipt` in full.
- `api/src/modules/suppliers/suppliers.service.ts:230-250, 648-660` and
  `suppliers.repository.ts:218-330` — the supplier-product seam and `updateLastCost`.
- `packages/shared/src/inventory.ts:16-40` — the average-cost rule.
- `admin/src/modules/inventory/components/receive-dialog.tsx` — the existing receipt form, for the
  shape of the data a receiver actually types (Plan 09 reuses it).

## Tasks

### 1. `createReceipt` accepts an executor and a purchase order

`api/src/modules/inventory/inventory.service.ts`:

```ts
export interface ReceiptCreateInput {           // existing, extended
  branchId: string
  supplierId?: string
  supplierName?: string
  supplierInvoiceNumber?: string
  note?: string
  purchaseOrderId?: string                      // NEW
  idempotencyKey?: string                       // NEW
  lines: readonly {
    productId: string
    quantity: number
    unitCostMinor: number
    purchaseOrderLineId?: string                // NEW
    overReceiptReason?: OverReceiptReason        // NEW
    overReceiptNote?: string | null              // NEW
  }[]
}

export async function createReceipt(
  user: SessionUser,
  actor: AuditActor,
  input: ReceiptCreateInput,
  options: { executor?: DbExecutor } = {},
): Promise<ReceiptDetail>
```

- When `options.executor` is supplied, the body runs on it instead of opening its own
  transaction. Every existing statement inside (`allocateFromSequence('inventory.receiptSequence',
  tx)`, `insertReceipt`, `postMovements(..., { executor: tx })`, `insertReceiptLine`,
  `writeAudit`) is unchanged.
- **The final read must use the same executor.** `loadReceipt` used the pool, so a receipt created
  inside the caller's transaction was invisible to it and the endpoint answered 404 — found by the
  first receiving test. `loadReceipt(receiptId, executor = db)` now takes the executor and
  `createReceipt` passes `options.executor ?? db`.
- The public route `POST /api/inventory/receipts` passes **no** options and keeps its schema, so
  a console receipt cannot pretend to be a PO receipt. Only `procurement.service` passes
  `purchaseOrderId`.
- The receipt line insert carries `purchaseOrderLineId`, `overReceiptReason`, `overReceiptNote`.
- The existing `unique(receipt_id, product_id)` stays; a PO cannot carry a product twice, so a
  receipt against one order cannot either.

### 2. Derived catalogue cost (P11-D13)

`inventory.repository.ts`:

```ts
/** The one cross-module write in this codebase. See P11-D13 for why it lives here. */
export async function updateDerivedCost(
  productId: string, costMinor: number, executor: DbExecutor,
): Promise<void>
```

It sets `product.cost_price_minor = costMinor, updated_at = now()`.

`postMovements` calls it **only** for `type === 'RECEIPT'` inbound movements, after the movement
row is inserted and the level is updated, inside the same transaction. Not for `TRANSFER_IN`
(a transfer does not set what the business pays for the part), not for `ADJUSTMENT` or
`COUNT_VARIANCE`, not for `SUPPLIER_RETURN`.

The doc comment states the reason plainly: `products.service.ts:13` already imports
`inventory.service.getOnHandTotal`, so the reverse import would be a module cycle; this is a
schema-level write, the same class of deliberate seam as `analytics.repository.ts` reading sibling
tables (P9-D10).

`products.validation.ts` / `products.service.ts`:

- `costPriceMinor` is **removed** from `productCreateSchema` and `productUpdateSchema`; a request
  containing it now fails `.strict()` with a 400 rather than being silently ignored.
- `createProduct` inserts `costPriceMinor: 0`; `updateProduct` no longer accepts it.
- Existing tests that pass `costPriceMinor` are **updated, not deleted** — the assertion changes
  from "the value is stored" to "the field is rejected", and the plan records it as a deviation.

### 3. `suppliers.service.ensureSupplierProductLink` (PROC-09, D17)

```ts
export async function ensureSupplierProductLink(
  actor: AuditActor,
  input: { supplierId: string; productId: string; unitCostMinor: number; occurredAt: Date },
  executor: DbExecutor,
): Promise<{ mappingId: string; created: boolean }>
```

- `insertSupplierProductIfAbsent` in `suppliers.repository.ts`
  (`onConflictDoNothing` on `(supplier_id, product_id)`), then re-read the row.
- `updateLastCost(supplierId, [productId], map, occurredAt, executor)` — the existing function,
  unchanged, so `last_cost_minor` and `last_cost_at` keep one definition.
- `leadTimeDays` stays **null**: a cost is a fact once goods arrive; a lead time is a promise only
  the manager can complete (D17).
- Audit `supplier_product.created` with `{ via: 'receipt', receiptId }` only when inserted.
- The link is created on **receipt**, never on order creation.

A pleasant consequence worth a test: `recordInvoiceCosts` (`suppliers.service.ts:648-660`) has
always no-opped for unmapped products. After this plan, a receipt has already created the link, so
the invoice path updates an existing row — D17 fixes a bug by ordering, not by adding a branch.

### 4. `procurement.service.receiveOrder`

```ts
export async function receiveOrder(
  user: SessionUser, actor: AuditActor, orderId: string,
  input: {
    idempotencyKey: string
    supplierInvoiceNumber?: string
    note?: string
    lines: {
      purchaseOrderLineId: string
      quantity: number
      unitCostMinor: number
      overReceiptReason?: OverReceiptReason
      overReceiptNote?: string
    }[]
  },
): Promise<{ receipt: ReceiptDetail; order: OrderDetail }>
```

One transaction:

1. `lockOrderForUpdate`; status must be `APPROVED`, `SENT` or `PARTIALLY_RECEIVED` (P11-D19);
   anything else → **409** with a sentence naming the status.
2. `assertBranchAccess(user, order.branchId)`.
3. Idempotency: an existing `stock_receipt` with this `(branch_id, idempotency_key)` returns that
   receipt and the order unchanged (`replayed: true`). **This check runs before the status guard**
   — after a full receipt the order is `RECEIVED`, so a retried request would otherwise be refused
   as an illegal transition instead of replayed.
4. Every input line must belong to this order; duplicate `purchaseOrderLineId` → 400; quantity
   `> 0`.
5. `receivedBefore = selectReceivedByOrderLine(order.id, tx)`; for each line
   `outstanding = quantity − receivedBefore`; if `quantity > outstanding` and no
   `overReceiptReason` → **400** `An over-delivery needs a reason` — and the message states the
   ordered, received and outstanding quantities. With a reason, the over-delivery is recorded as
   given (never clamped).
6. `createReceipt(user, actor, { …purchaseOrderId, lines with PO line ids }, { executor: tx })` —
   allocates the GRN number, posts the movements, updates average cost and derived cost, writes
   the lines and audits `stock_receipt.created`.
7. For each received product: `ensureSupplierProductLink` (supplier from the **order**, not from
   the receipt's free-text name).
8. `orderFulfilment(ordered/receivedAfter)` → `RECEIVED` when every line is met,
   `PARTIALLY_RECEIVED` otherwise. Never back to `SENT`: once something arrived, the order is
   partially received even if a later receipt completes it.
9. `writeAudit('purchase_order.received')` with per-line
   `{ ordered, receivedBefore, receivedNow, receivedAfter, overReceiptReason }` — the before/after
   a reconciliation needs.

Validation (`procurement.validation.ts`):

```ts
export const receiveSchema = z.object({
  idempotencyKey: z.uuid(),
  supplierInvoiceNumber: z.string().trim().min(1).max(60).optional(),
  note: z.string().trim().max(300).optional(),
  lines: z.array(z.object({
    purchaseOrderLineId: z.uuid(),
    quantity: z.number().int().min(1).max(1_000_000),
    unitCostMinor: z.number().int().min(0).max(100_000_000_000),
    overReceiptReason: z.enum([...]).optional(),
    overReceiptNote: z.string().trim().max(300).optional(),
  }).strict()).min(1).max(100),
}).strict().refine(noDuplicateLines)
```

Route: `POST /api/procurement/orders/:id/receive`, permission `procurement.receive`.

The order detail's `canApply.receive` already reflects the status rule (Plan 04); this plan adds
no new rule to the screen.

### 5. Tests

`procurement.test.ts` additions:

- **full receipt**: 10 ordered, 10 received → order `RECEIVED`; stock on hand +10;
  `stock_level.avg_cost_minor` equals the receipt cost when the branch had none;
  `product.cost_price_minor` equals the receipt cost; one `SUPPLIER_RETURN`-free movement of type
  `RECEIPT` with `reference_type = 'RECEIPT'`.
- **partial then short**: 10 ordered, 6 received → `PARTIALLY_RECEIVED`, outstanding 4; a second
  receipt of 4 → `RECEIVED`; ledger totals 10.
- **over-delivery**: 10 ordered, 11 received without a reason → 400; with
  `SUPPLIER_SENT_MORE` → 201, `stock_receipt_line.over_receipt_reason` recorded,
  `quantity_on_hand` 11.
- **receiving a draft / cancelled / closed order** → 409; **receiving a `PENDING_APPROVAL`
  order** → 409 (goods cannot arrive against an undecided order).
- **idempotency**: same key twice → one receipt, one movement set, same numbers.
- **average cost**: existing stock 10 @ 100, receipt 10 @ 200 → `avg_cost_minor` 150
  (uses `averageCostAfterReceipt`; no new arithmetic).
- **supplier link auto-created** with the receiving supplier and `last_cost_minor`; a second
  receipt from the same supplier updates `last_cost_at` and keeps one row.
- **derived cost**: a `TRANSFER_IN` does **not** change `product.cost_price_minor` (P11-D13's
  negative case).
- **branch IDOR**: a manager receiving against another branch's order → 403.

`inventory.test.ts` additions: `createReceipt` with an executor enlists in the caller's
transaction — a failing caller statement rolls the receipt back, leaving no movement, no level
change and no receipt row.

## Verification

```bash
bun run --filter api test
bun run check-types
bun run lint
```

Reconciliation query, run after the walkthrough fixtures:

```sql
-- ordered = received + outstanding, per line
SELECT pol.id, pol.quantity,
       coalesce(sum(srl.quantity), 0) AS received,
       pol.quantity - coalesce(sum(srl.quantity), 0) AS outstanding
  FROM purchase_order_line pol
  LEFT JOIN stock_receipt_line srl ON srl.purchase_order_line_id = pol.id
 GROUP BY pol.id, pol.quantity;

-- on hand equals the ledger, per product/branch touched by the walkthrough
SELECT sl.product_id, sl.quantity_on_hand, coalesce(sum(sm.quantity_delta), 0) AS ledger
  FROM stock_level sl
  LEFT JOIN stock_movement sm ON sm.product_id = sl.product_id AND sm.branch_id = sl.branch_id
 GROUP BY sl.product_id, sl.quantity_on_hand
HAVING sl.quantity_on_hand <> coalesce(sum(sm.quantity_delta), 0);
-- 0 rows
```

## Commits

1. `feat(api): receipts can enlist in a caller transaction and carry a purchase order`
2. `feat(api): catalogue cost follows the latest receipt`
3. `feat(api): the first receipt creates the supplier-product link`
4. `feat(api): receive against an order with partial, short and over deliveries`
5. `test(api): receipt quantities, average cost and the derived-cost boundary`

## Done when

- Every PROC-03 case is representable and proven: full, partial, short, over with a reason.
- The order detail's ordered/received/outstanding figures come from one query, used by receiving
  and by replenishment.
- A first delivery creates the supplier link with its cost and no invented lead time.
- `product.cost_price_minor` changes on a receipt and on nothing else, and the write path is
  documented where it lives.
- No second stock write path exists: `grep -rn "insert(stockMovement)" api/src` returns only
  `inventory.repository.ts`.
