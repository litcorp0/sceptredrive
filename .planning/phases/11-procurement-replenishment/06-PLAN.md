---
phase: 11-procurement-replenishment
plan: 06
title: Invoice matching against a purchase order
lane: api
depends_on: [05]
requirements: [PROC-04, PROC-08]
---

# Plan 06 — The invoice never blocks, and never lies

## Goal

A supplier invoice can name the purchase order it settles. Every line is compared to the order
line it belongs to, and a price or quantity difference is flagged with both values. The payable
posts anyway — a documentation gap must not stop a supplier being paid — and the variance is the
reconciliation hook a manager works from.

## Read first

- `00-CONTEXT.md` D5 (the PO link on the invoice) and `01-RESEARCH.md` § "Three-way matching" —
  the reason the link has to be per line, not only per header.
- P11-D2 and P11-D17 in `00-DECISIONS.md`.
- `api/src/modules/payables/payables.service.ts:135-356` — `createInvoice` end to end.
- `api/src/modules/payables/payables.repository.ts:54-137, 304-364` — invoice insert, detail, lines.
- `api/src/modules/payables/payables.schema.ts:103-124` — the invoice line, and its partial unique
  on `(invoice_id, product_id)`.
- `packages/shared/src/tax.ts` — `taxBreakdown`, unchanged by this plan.

## Tasks

### 1. Validation

`payables.validation.ts`:

- `invoiceCreateSchema` gains `purchaseOrderId: z.uuid().optional()`.
- Each line gains `purchaseOrderLineId: z.uuid().optional()`. When omitted, the service matches by
  product within the named order; when the order is not named, it is ignored.
- A `purchaseOrderId` with a line-level id from a different order → 400, naming the line.

### 2. A read seam, not a repository import

`procurement.service.ts`:

```ts
export interface OrderLineForMatch {
  id: string
  productId: string
  quantity: number
  unitCostMinor: number
  receivedQuantity: number
}

/** Used by payables to match an invoice. Read-only and branch/supplier checked. */
export async function getOrderLinesForMatch(
  orderId: string,
  scope: { branchId: string; supplierId: string },
  executor: DbExecutor,
): Promise<{ orderNumber: string; status: PurchaseOrderStatus; lines: OrderLineForMatch[] }>
```

Throws **403** when the order belongs to another branch (the same object-level rule as every other
foreign id), **400** when it belongs to another supplier (the request is inconsistent, not
forbidden), and `AppError('CONFLICT', …)` for `CANCELLED`/`REJECTED` orders — an invoice cannot
cite a document that no longer exists.

`payables.service` imports **this service function**, never `procurement.repository`. The
dependency is one-way: `payables → procurement`, never the reverse.

`payables.repository.ts` gains:

```ts
selectInvoicedQuantityByOrderLine(orderId, executor)   // excludes VOID invoices
updateInvoiceLineMatch(lineIds, links, tx)
selectInvoiceMatchDetail(invoiceId, executor)
```

`selectInvoicedQuantityByOrderLine` is
`sum(supplier_invoice_line.quantity)` joined to `supplier_invoice` with
`status <> 'VOID'` and `id <> $currentInvoice`, grouped by `purchase_order_line_id`. `.mapWith(Number)`.

### 3. The match itself

Inside `createInvoice`'s existing transaction, after the lines are inserted and **before** the
audit entry:

```
for each invoice line:
  poLine = lines.find(l => l.id === line.purchaseOrderLineId)
        ?? lines.find(l => l.productId === line.productId)

  if (!poLine)                         → NOT_ON_ORDER
  priceVariance  = line.unitCostMinor !== poLine.unitCostMinor
  invoicedAfter  = alreadyInvoiced[poLine.id] + line.quantity
  quantityVariance = invoicedAfter > poLine.receivedQuantity
  → MATCHED | PRICE_VARIANCE | QUANTITY_VARIANCE | PRICE_AND_QUANTITY_VARIANCE
```

- The comparison is against **received** quantity, not ordered: invoicing goods that never arrived
  is the exact thing matching exists to catch.
- An invoice that arrives before the goods is therefore `QUANTITY_VARIANCE` with
  `received = 0`. That is a normal state, not an error (research: `OPEN_RECEIPT`).
- `NOT_ON_ORDER` when the product has no line on the cited order — a supplier billing for
  something nobody ordered. Its row keeps `purchase_order_line_id` null and stores only the
  status, so the invoice detail still has to show it: the detail query **left-joins** the order
  line and product, and returns `orderedQuantity: null` rather than pretending zero.
- With no `purchaseOrderId`, every line stays `UNMATCHED` and behaviour is byte-identical to
  today.

Write `purchase_order_line_id` and `match_status` with `updateInvoiceLineMatch`.

Audit `supplier_invoice.matched` with:

```json
{ "purchaseOrderId": "…", "orderNumber": "PO-ACC-202610-0001",
  "variances": [{ "lineNumber": 2, "productId": "…", "status": "PRICE_VARIANCE",
                  "invoicedUnitCostMinor": 5200, "orderedUnitCostMinor": 5000,
                  "invoicedQuantity": 10, "receivedQuantity": 10 }] }
```

The audit carries **both values** for every variance. The invoice detail's read model carries the
same numbers, so a manager can act without reading the log.

**Nothing in this path may throw for a variance.** The only 4xx outcomes are structural: a foreign
branch, a cancelled order, a line that does not belong to the named order. Every price and
quantity difference is data.

### 4. Read models

`GET /api/procurement/orders/matchable?supplierId=&branchId=` — a small read for the invoice
form's picker: orders in `APPROVED`, `SENT` or `PARTIALLY_RECEIVED` for the supplier, with number,
expected date and goods value. Ten rows, `procurement.read`, branch-scoped. It exists so the
console never assembles a multi-status filter out of three requests.

`GET /api/payables/invoices/:id` (existing route) gains:

```ts
match: {
  purchaseOrderId: string
  orderNumber: string
  status: InvoiceMatchStatus          // worst status across lines
  lines: [{
    lineNumber, productId, sku, name,
    invoicedQuantity, orderedQuantity, receivedQuantity, previouslyInvoicedQuantity,
    invoicedUnitCostMinor, orderedUnitCostMinor,
    matchStatus,
  }]
} | null
```

`GET /api/payables/invoices` gains `matchStatus?: InvoiceMatchStatus` as a filter, for the
console's "needs attention" view. The list row gains `purchaseOrderNumber` and `matchStatus`
(null when unmatched), so the payables screen can flag without opening.

### 5. Tests

`payables.test.ts` additions — every case asserts the **payable posted**, because that is the
requirement most likely to be broken by a well-meaning guard:

| Case | Expected `match_status` | Payable |
|---|---|---|
| invoice price = PO price, qty ≤ received | `MATCHED` | posts |
| price 5 200 vs 5 000 | `PRICE_VARIANCE`, both values in the audit | posts |
| quantity 12 vs received 10 | `QUANTITY_VARIANCE` | posts |
| both | `PRICE_AND_QUANTITY_VARIANCE` | posts |
| product not on the order | `NOT_ON_ORDER` | posts |
| no receipt yet | `QUANTITY_VARIANCE`, received 0 | posts |
| order from another supplier | 400, nothing written | — |
| order from another branch | 403 | — |
| invoice against a cancelled order | 409 | — |

Plus:

- a second invoice for the same order line adds to `alreadyInvoiced`: 10 received, invoice 6 then
  6 → the second is `QUANTITY_VARIANCE`;
- **voiding** the first invoice removes it from `alreadyInvoiced`, so re-invoicing 6 is `MATCHED`
  again;
- no `purchaseOrderId` → every line `UNMATCHED` and the existing suite passes unedited.

`procurement.test.ts` additions: `getOrderLinesForMatch` returns `receivedQuantity` from the one
receipt aggregate (Plan 05) and 400s for a foreign supplier.

`payables.api.test.ts`: 403 for a manager citing another branch's order; 200 with a variance.

## Verification

```bash
bun run --filter api test
bun run check-types
bun run lint
```

```sql
-- every matched line has a status and every variance has a PO line
SELECT match_status, count(*) FROM supplier_invoice_line GROUP BY match_status;

-- the payable is unchanged by matching: total owed still equals invoices minus paid
SELECT s.code, sum(i.total_minor - i.amount_paid_minor) AS outstanding
  FROM supplier_invoice i JOIN supplier s ON s.id = i.supplier_id
 WHERE i.status <> 'VOID' GROUP BY s.code;
```

## Commits

1. `feat(api): an invoice can cite its purchase order`
2. `feat(api): line-level price and quantity variance, recorded not enforced`
3. `feat(api): match status on the invoice detail and list`
4. `test(api): every variance shape still posts the payable`

## Done when

- An invoice can be matched to an order and every line carries a status.
- Both values of every variance are in the audit entry and the read model.
- No variance prevents the payable from posting; only structural errors return 4xx.
- Voiding an invoice removes it from the invoiced-quantity calculation.
- An invoice with no order behaves exactly as it did before this phase.
