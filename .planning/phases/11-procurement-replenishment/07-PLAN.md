---
phase: 11-procurement-replenishment
plan: 07
title: Purchase returns and supplier credit notes
lane: api
depends_on: [05]
requirements: [PROC-05, PROC-08, MGR-04]
---

# Plan 07 — Sending it back

## Goal

Wrong parts go back. A return names the receipt lines it comes from, is capped by what was
actually received and not already returned, posts a negative stock movement, and creates the
credit note that reduces what the branch owes — in one transaction, so the payables ledger is
never out of step with the stock ledger.

Nothing is edited and nothing is deleted: a posted return is a new fact, and a mistake is
corrected by a compensating document.

## Read first

- `00-DECISIONS.md` P11-D1, P11-D9, P11-D17, P11-D20.
- `api/src/modules/inventory/inventory.service.ts:67-186` — `postMovements`, including the
  **negative-stock guard** and the outbound `unit_cost_minor = avg_cost` rule.
- `api/src/modules/inventory/inventory.repository.ts:239-268` — `selectReceiptLines`.
- `api/src/modules/payables/payables.service.ts:757-830` — balances and aging, where the credit
  enters.
- `api/src/modules/payables/payables.repository.ts:593-676` — the two queries behind a balance.
- `api/src/modules/suppliers/suppliers.repository.ts:345` — `sumSupplierOwed`, which must change
  or a fully-returned supplier cannot be archived.

## Tasks

### 1. Return + credit-note repository

`procurement.repository.ts`:

```ts
insertReturn(values, executor)
insertReturnLines(values, executor)
findReturnById(id, executor)
lockReturnForUpdate(id, executor)
findReturnByIdempotency(branchId, key, executor)
updateReturnRow(id, patch, executor)
selectReturnPage(filters) / countReturns(filters)
selectReturnLines(returnId, executor)                  // joins product + receipt line
selectReturnedQuantityByReceiptLine(receiptLineId, excludeReturnId, executor)
selectReceiptLinesForReturn(receiptIds, branchId, executor)
insertCreditNote(values, executor)
findCreditNoteByReturn(returnId, executor)
selectCreditNotePage(filters)
```

`selectReturnedQuantityByReceiptLine` sums `supplier_return_line.quantity` joined to
`supplier_return` with `status = 'POSTED'`; a `DRAFT` return reserves nothing (it is a
worksheet), so two drafts can both propose the same unit and only one posts. The second post then
fails the cap check with a clear message — correct, and cheaper than a reservation system nobody
asked for.

### 2. Validation

```ts
export const returnCreateSchema = z.object({
  branchId: z.uuid(),
  supplierId: z.uuid(),
  purchaseOrderId: z.uuid().optional(),
  receiptId: z.uuid().optional(),
  reason: z.string().trim().min(3).max(300),
  note: z.string().trim().max(300).optional(),
  supplierCreditNoteNumber: z.string().trim().min(1).max(60).optional(),
  idempotencyKey: z.uuid(),
  lines: z.array(z.object({
    receiptLineId: z.uuid(),
    quantity: z.number().int().min(1).max(1_000_000),
  }).strict()).min(1).max(100),
}).strict().refine(noDuplicateReceiptLines)
```

The unit cost is **never** in the request. It comes from `stock_receipt_line.unit_cost_minor`,
which is what the branch actually paid — a typed cost would let a return invent a credit value.

### 3. Create (DRAFT) and post (POSTED)

```ts
export async function createReturn(user, actor, input): Promise<ReturnDetail>
export async function postReturn(user, actor, returnId): Promise<ReturnDetail>
export async function cancelReturn(user, actor, returnId, reason): Promise<ReturnDetail>
export async function getReturn(user, returnId): Promise<ReturnDetail>
export async function listReturns(user, query): Promise<ReturnList>
```

**`createReturn`** — one transaction:

1. `assertBranchAccess(user, input.branchId)`; `requireSupplier`.
2. Every `receiptLineId` must belong to a receipt at this branch, from this supplier. Otherwise
   **400** — a return cannot name another branch's receipt.
3. `returned = selectReturnedQuantityByReceiptLine(...)`; if `quantity > receiptLine.quantity −
   returned` → **400** `You can return at most N of the M received`.
4. Allocate `PR-…`, insert the return (`DRAFT`) and its lines with the receipt line's unit cost.
5. Audit `supplier_return.created` with the total credit value.

A draft posts **nothing**: no movement, no credit note, no balance change.

**`postReturn`** — one transaction:

1. `lockReturnForUpdate`; status must be `DRAFT`, else 409.
2. Re-check every cap inside the transaction (another draft may have posted first).
3. Allocate `SCN-…` and insert `supplier_credit_note` with
   `amountMinor = Σ(quantity × unit_cost_minor)`.
4. `postMovements(actor, lines.map(l => ({
     productId, quantityDelta: -l.quantity, unitCostMinor: l.unitCostMinor,
     type: 'SUPPLIER_RETURN', referenceType: 'SUPPLIER_RETURN',
     referenceId: return.id, referenceNumber: return.number, note: input.reason,
   })), { executor: tx })`
5. Set `status = POSTED`, `posted_at`, `posted_by`, `credit_note_number`.
6. Audit `supplier_return.posted` with `{ creditNoteNumber, amountMinor, lineCount }`.

**The negative-stock guard is not bypassed.** `postMovements` already refuses a movement that
would take a branch below zero. If the goods were sold after they arrived, the return is refused
with the on-hand quantity named: return what is there, or adjust first. `allowNegative` is **not**
passed — an oversell is a POS reality with its own conflict path; a return is an office action
with no such excuse.

**`cancelReturn`** — `DRAFT` only; sets `CANCELLED` with a reason. A `POSTED` return has no cancel
path; the correction is a new document.

### 4. Payables: the credit enters the balance (P11-D9)

`payables.repository.ts`:

```ts
selectCreditNotesBySupplier(branchId: string | null, supplierId: string | null, executor)
```

`payables.service.ts`:

- `listSupplierBalances` — the result row gains `creditMinor`. `owedMinor` becomes
  `invoiceOutstandingMinor − onAccountMinor − creditMinor`. A supplier with **only** a credit note
  gets a row of its own (zeros plus the credit, so `owedMinor` is negative), which is why the
  credit query joins `supplier` for the code and name rather than returning ids alone — a
  credit-only supplier has no invoice query to borrow them from.
- `getAging` — each supplier row gains `creditMinor`; **the buckets are untouched**. A credit note
  has no due date, so bucketing it would invent one. The report's footnote says credit notes are
  shown separately and are not aged (the same sentence Phase 5 uses for on-account credit).
- `getAgingTotals` — `creditMinor` aggregated for the header.

`suppliers.repository.ts:345` — `sumSupplierOwed` becomes
`Σ(invoice total − paid) − Σ(on-account) − Σ(credit notes)`. Without this, `archiveSupplier`
(`suppliers.service.ts:286`) would let a supplier with a live credit balance be archived. A test
proves the block.

`reconcilePayables` (`payables.service.ts:904`) — the per-supplier reconciliation asserts:

```
invoiceOutstanding − onAccount − creditNotes === owedMinor
```

and the function's return type gains `creditNotesMinor` so the verification walkthrough can print
all three parts of the equation.

### 5. Routes

| Method | Path | Permission |
|---|---|---|
| GET | `/api/procurement/returns` | `procurement.read` |
| POST | `/api/procurement/returns` | `procurement.return` |
| GET | `/api/procurement/returns/:id` | `procurement.read` |
| POST | `/api/procurement/returns/:id/post` | `procurement.return` |
| POST | `/api/procurement/returns/:id/cancel` | `procurement.return` |

`ReturnDetail` carries: return header, lines (product, receipt number, received qty, previously
returned, returning now, unit cost, line credit), `creditNote`, `totalCreditMinor`, and
`canPost` / `canCancel` computed for the actor.

### 6. Tests

`procurement.test.ts` additions:

- create + post: one `SUPPLIER_RETURN` movement with `quantity_delta = -n`,
  `reference_type = 'SUPPLIER_RETURN'`, `reference_id = return.id`; `quantity_on_hand` reduced by
  `n`; a `supplier_credit_note` of `n × unit cost`; supplier `owedMinor` reduced by exactly that.
- draft posts nothing: no movement, no credit note, balance unchanged.
- over-return (quantity > received − returned) → 400 before anything is written.
- two returns against the same receipt line: 6 + 4 of 10 succeeds; a third of 1 → 400.
- return after the stock was sold → 409 from the negative-stock guard; no movement, no credit
  note, return stays `DRAFT`.
- cancel a draft → `CANCELLED`, still no ledger effect; cancel a posted return → 409.
- **reconciliation**: after an invoice of 100 000 and a return of 30 000,
  `invoiceOutstanding − creditNotes === owedMinor === 70 000`.
- **aging untouched**: the supplier's aging buckets sum to the invoice outstanding, and
  `creditMinor` is reported beside them.
- **archive blocked**: a supplier with only a credit note still shows owed ≠ 0 and cannot be
  archived.
- idempotent create: same key twice → one return.
- branch IDOR: a manager returning another branch's receipt → 400; another branch's return id →
  403.

`payables.test.ts` additions: `creditMinor` in balances and aging; `reconcilePayables` still
balances with a credit note present.

## Verification

```bash
bun run --filter api test
bun run check-types
bun run lint
```

```sql
-- invoice + credit note = supplier balance, for every supplier with activity
SELECT s.code,
       coalesce(sum(i.total_minor - i.amount_paid_minor), 0) AS invoiced,
       coalesce((SELECT sum(cn.amount_minor) FROM supplier_credit_note cn
                  WHERE cn.supplier_id = s.id), 0)          AS credited
  FROM supplier s LEFT JOIN supplier_invoice i ON i.supplier_id = s.id AND i.status <> 'VOID'
 GROUP BY s.code;

-- every return line has a posted return and a credit note
SELECT count(*) FROM supplier_return_line l
  JOIN supplier_return r ON r.id = l.return_id
  LEFT JOIN supplier_credit_note cn ON cn.return_id = r.id
 WHERE r.status = 'POSTED' AND cn.id IS NULL;   -- 0
```

## Commits

1. `feat(api): supplier returns as a draft that posts nothing`
2. `feat(api): posting a return moves stock and creates its credit note`
3. `feat(api): credit notes reduce the supplier balance, never the aging buckets`
4. `test(api): return caps, negative stock, and the payables equation`

## Done when

- A return is capped by received-minus-returned per receipt line, checked twice (create and post)
  inside the transaction.
- Posting a return is one transaction: movement, credit note, status, audit.
- `invoice + credit note = balance` holds in `listSupplierBalances`, `getAging` totals and
  `reconcilePayables`.
- A posted return cannot be cancelled or edited, and the stock guard refuses a return of goods the
  branch does not hold.
- The console's payables screens show the credit without inventing a due date for it.
