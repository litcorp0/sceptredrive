---
phase: 13-pos-payments-returns
plan: 05
title: Refunds — document, caps, restock, credit reduction, retrospective approval
lane: api
depends_on: [04]
requirements: [POS-10, PAY-03, APR-01, APR-02, APR-04]
---

# Plan 05 — Money goes back the way it came in

## Goal

A refund uploaded by a till becomes a numbered document that names the lines, the tenders, the
restock decision and the manager who authorised it. It posts stock back only where the goods can be
resold, reduces the credit ledger only where credit was taken, dispatches a Paystack refund only for
the electronic portion, and raises the `REFUND` approval head office has been waiting for since
Phase 12 — without ever touching the sale.

## Read first

- `00-DECISIONS.md` P13-D17 … P13-D26.
- `01-RESEARCH.md` §3 items 3 and 5, §4 items 19–21, 24, 26.
- `api/src/modules/pos/pos.service.ts:803-838` (`assertSaleShape`, `saleRejected`), `:1088-1162`
  (the credit posting this plan mirrors), `:1458-1470` (`registerDecisionHandler` shape).
- `api/src/modules/inventory/inventory.service.ts` — `postMovements` and its options.
- `api/src/modules/credit/credit.service.ts:124-188` — `normalizeEntryInput`'s `REFUND` rule.
- `api/src/modules/approvals/approvals.service.ts:61-126,454-465` — the registries and `SUBJECT_KIND`.
- `api/src/modules/approvals/approvals.types.ts:66-150` — `ApprovalSubject`.
- `api/src/modules/writeoffs/writeoffs.service.ts` — the Phase 12 document + approval + posting shape
  to imitate.
- `packages/shared/src/refund.ts` (Plan 01).

## Tasks

### 1. The wire contract

`sync.types.ts`: `UploadTransactionType` gains `'REFUND'`. `sync.validation.ts` gains
`refundPayloadSchema`:

```ts
{
  saleId: z.uuid(),
  number: z.string().regex(/^[A-Za-z0-9-]+$/).max(64),
  shiftId: z.uuid(),
  cashier: { userId, staffId, bindingId, bindingToken, pinVersion },
  reasonCode: z.enum(REFUND_REASONS),
  note: z.string().trim().max(300).nullish(),
  approval: overrideProofSchema,                  // required (P13-D24)
  lines: z.array(z.object({
    saleLineId: z.uuid(),
    quantity: z.number().int().min(1).max(10_000),
    restock: z.enum(REFUND_RESTOCK_OPTIONS),
    damageReason: z.string().trim().max(120).nullish(),
  })).min(1).max(200),
  tenders: z.array(z.object({
    saleTenderId: z.uuid(),
    amountMinor: minorUnits,
  })).min(1).max(5),
  refundedMinor: minorUnits,
  occurredAt: z.iso.datetime(),
}
```

`.superRefine`: `DAMAGED` requires a `damageReason` of at least 3 characters and every other restock
forbids it; `refundedMinor` must equal `Σ tenders.amountMinor`.

`dispatchTransaction` gains a `'REFUND'` arm calling `applyRefund(device, payload, tx)`.

### 2. `applyRefund` — `pos.service.ts` (or `pos.refunds.service.ts`, see task 8)

```ts
export async function applyRefund(
  context: SaleContext,
  payload: RefundPayload,
  executor: DbExecutor = db,
): Promise<RefundApplyResult>
```

Ordered, before any write:

1. **Lock the sale**: `findSaleByIdForUpdate(payload.saleId)` — `SELECT … FOR UPDATE` on `sale`.
   Missing → `REFUND_SALE_MISSING`; different branch/terminal → `REFUND_SALE_FOREIGN`; different
   shift **is allowed** (a refund can cross a shift boundary; the sale's shift is history).
2. **Authorise**: `validateOverrideProof(executor, device, payload.approval, 'pos.refund')`. The
   approver must not be the uploading cashier (the existing helper already refuses that).
3. **Cap the lines**: load the sale's lines and the already-refunded quantities grouped by
   `sale_line_id`. Each requested quantity ≤ `refundableQuantity`. Over → `REFUND_EXCEEDS_LINE`.
4. **Cap the tenders**: load the sale's tenders and the already-refunded amounts per
   `sale_tender_id`. Run `refundAllocationProblem` (Plan 01) with the sale's `tender_total_minor`
   and `change_minor`. Any problem → `REFUND_EXCEEDS_TENDER` / `REFUND_SUM_MISMATCH` /
   `REFUND_EXCEEDS_SALE`.
5. **Duplicate number**: `findRefundByNumber` → `REFUND_NUMBER_CONFLICT` (409-class, stored
   `REJECTED`).

Then, in order:

6. **Money per line**, through `allocateProportionally` weighted `[requested, remaining]` **per
   component** (`base`, `vat`, `nhil`, `getfund`, `tax_total`, `total`). A full-line refund therefore
   returns the line's own figures to the pesewa, and the sum of every refund of a line equals the
   line component by component.
7. **`refund` row**: `id = context.clientTransactionId`, `number`, `sale_id`, branch/terminal/device,
   `shift_id`, `customer_id` (from the sale), `reason_code`, `note`, `refunded_minor`, the five tax
   columns, `base_minor`, the PIN proof columns, `occurred_at`, `received_at`.
8. **`refund_line` rows** with `unit_cost_minor` copied from the sale line (the ledger needs the cost
   the goods were sold at, not today's average).
9. **`refund_tender` rows**: cash and credit `SETTLED` with `settled_at = now`; electronic `PENDING`.
10. **Stock**: for each `RESALABLE` line, one inbound movement through `postMovements`:
    `type: 'RETURN'`, `referenceType: 'REFUND'`, `referenceId: refund.id`,
    `referenceNumber: refund.number`, `quantityDelta: +quantity`,
    `unitCostMinor: sale_line.unit_cost_minor`, `note` naming the receipt. `DAMAGED` and
    `NOT_RETURNED` post **nothing** (P13-D22).
11. **Credit**: if `Σ credit refund_tender > 0`, `postEntryInTransaction(tx, actor, null, { kind:
    'REFUND', customerId, branchId, amountMinor: −creditPortion, reasonCode: 'RETURN',
    referenceType: 'REFUND', referenceId: refund.id, referenceNumber: refund.number,
    idempotencyKey: `${refundId}:credit`, occurredAt })`.
12. **Approval**: when `refundApprovalRequired(refundedMinor, threshold)` — where `threshold` is
    `getSettingValue('pos.refundApprovalThresholdMinor', { branchId })` —
    `requestApproval(cashierActor, { type: 'REFUND', entityId: refund.id, branchId,
    amountMinor: refundedMinor, deciderRole: 'ADMIN', deciderBranchId: null, note,
    payload: { refundId, number, saleId, receiptNumber, refundedMinor, reasonCode,
    lineCount, cashTendersMinor, creditMinor, electronicMinor, approvedBy: approval.approverStaffId } },
    executor)`, and store `approval_id` on the refund.
13. **Audit**: one `pos.refund.applied` row with the before (`sale.refunded` running total) and after
    figures, one `pos.refund.override` naming the approver, and one `pos.refund.approval_raised` when
    step 12 ran.

`RefundApplyResult = { refundId, number, refundedMinor, pendingDispatch: RefundTenderRef[] }`.

### 3. Register `REFUND` in the approvals registry

- `ApprovalSubject` gains:

  ```ts
  | { kind: 'refund'; refundId: string; number: string; saleId: string; receiptNumber: string
      refundedMinor: number; reasonCode: string; lineCount: number; itemCount: number
      restock: { resalable: number; damaged: number; notReturned: number }
      tenders: Array<{ method: string; amountMinor: number; status: string }>
      approvedBy: string; occurredAt: string; originalTotalMinor: number }
  ```

- `SUBJECT_KIND.REFUND` becomes `'refund'`.
- `registerDecisionHandler('REFUND', …)`: refuses `REJECTED` without a reason (the shared route
  already does), refuses a second decision, and **writes nothing but an audit row** —
  `pos.refund.reviewed` with `{ decision, reasonCode, note }`. The refund's money columns are not in
  any patch this plan writes, and the handler has no writer for them.
- `registerSubjectLoader('REFUND', …)` returns the arm above from the refund, its lines and its
  tenders.
- `app.ts` appends `'REFUND'` to **both** boot lists, and `approvals.registry.test.ts`'s `BOOT_LIST`
  gains it. The registry test's "unregistered type" case must switch to a type that is still
  unregistered — there is none left, so the case is rewritten to assert the 500 path via a
  deliberately wrong registration map instead of `REFUND`. That rewrite is part of this commit and
  is the honest way to keep the test meaningful.

### 4. Dispatch and settlement

`payments.service.applyProviderRefund` (declared in Plan 03, implemented here):

- `refund.pending` / `refund.processing` → stay `PENDING`, store `expected_at`;
- `refund.processed` → `SETTLED`, `settled_at`;
- `refund.failed` → `FAILED`, `failed_message`, audit `pos.refund.failed`. No conflict row: the row is
  the record, and Phase 14 lists it. (A conflict type is for money that moved in a way the ledgers
  cannot express; this one they can.)
- `refund.needs-attention` → `NEEDS_ATTENTION` with the provider's message. The customer must be paid
  by another route and a manager decides how; **no automatic action**.

The webhook's `refund.*` branch finds the `refund_tender` by `provider_refund_reference` (stored by
the dispatch job) or, before dispatch, by the `data.transaction_reference` in `payment.provider_reference`
plus the amount.

`POS_REFUND_DISPATCH_QUEUE` worker:

```ts
const pending = await findRefundTendersToDispatch(50)   // status PENDING, created > 2s ago
for (const tender of pending) {
  const payment = await findPaymentForRefund(tender)    // joins sale_tender.payment_id
  const result = await provider.refund({ reference: payment.provider_reference,
    amountMinor: tender.amount_minor, note: `Refund ${refundNumber}` })
  await markDispatched(tender.id, result)
}
```

Idempotent: a tender already carrying `provider_refund_reference` is skipped, so a retried job never
refunds twice. Registered with `boss.work`, not scheduled — the enqueue is immediate, and a **15-minute
sweep** (`boss.schedule(POS_REFUND_DISPATCH_QUEUE, '*/15 * * * *')`) catches anything enqueued while
the process was down. Add it to `registerJobHandlers` and to the existing schedule loop.

Enqueue after commit: `applyUpload` gains a `postCommit` list — `applyTransaction` returns
`{ result, postCommit? }`; the hook is awaited **after** the transaction resolves, and a failure to
enqueue is logged, not thrown (the sweep will find it).

### 5. Read side

`getRefund(device, id)` and `listRefundsForSale(device, saleId)` are device-scoped (own terminal) and
exist for the till's receipt and the console's Phase 14 screen. No admin route in this phase.

### 6. Tests (`pos.refund.test.ts`, `payments.refund.test.ts`)

Fixtures: a completed three-tender sale (cash 30, credit 30, card 40) on a 100.00 sale, and a
single-tender cash sale.

- refund 1 unit of a 3-unit line, `RESALABLE` → `+1` stock movement of type `RETURN`, reference
  `REFUND`; the sale's `total_minor`, `tender_total_minor` and `change_minor` are byte-identical;
- refund the remaining 2 → the three components summed over both refunds equal the line's exactly;
- a fourth unit → `REFUND_EXCEEDS_LINE`, nothing written;
- refund cash 20 and card 20 → two `refund_tender`, card `PENDING`, one `pos-refund-dispatch` job
  enqueued;
- refund 60 card on a 40 card tender → `REFUND_EXCEEDS_TENDER`;
- refund 91 on a 100 sale with 10 change → `REFUND_EXCEEDS_SALE`; 90 → OK;
- refund the credit portion 30 → `credit_ledger_entry` of kind `REFUND`, amount **−30 000**, and the
  balance drops by exactly that; no cash movement;
- `DAMAGED` with no reason → 400; with a reason → **zero** stock movements and the reason stored;
- `NOT_RETURNED` → zero stock movements;
- a refund of exactly 20 000 raises one `PENDING` `REFUND` approval with
  `deciderRole = 'ADMIN'`, `deciderBranchId = null`; 19 999 raises none;
- five refunds of 15 000 each on one sale raise **zero** approvals (no accumulation);
- the same refund uploaded twice → one refund, `REPLAYED`;
- an approver who is the uploading cashier → 403 `OVERRIDE_INVALID`;
- an approver without `pos.refund` → `OVERRIDE_INVALID`;
- the `REFUND` decision handler writes no money: every `refund` column is identical before and after
  the decision;
- the webhook `refund.processed` moves the tender to `SETTLED`; a replay changes nothing;
- the dispatch job run twice refunds once (assert the mock's counter).

### 7. Ledger reconciliation test

After the whole sequence:

```sql
SELECT
  (SELECT SUM(quantity_delta) FROM stock_movement WHERE reference_id = $refundId) AS moved,
  (SELECT SUM(amount_minor) FROM credit_ledger_entry WHERE reference_id = $refundId) AS credit,
  (SELECT SUM(amount_minor) FROM refund_tender WHERE refund_id = $refundId) AS tenders,
  (SELECT refunded_minor FROM refund WHERE id = $refundId) AS refunded
```

`moved` equals only the `RESALABLE` quantities, `credit` equals `−credit tender`, `tenders =
refunded`.

## Verification

```bash
bun run --filter api test
bun run check-types
bun run lint
```

Expected: API **~655 → ~700**. `desktop/**` untouched; the till cannot send a `REFUND` until Plan 10,
and an unknown type is a validation 400, not a crash.

## Commits

1. `feat(api): the refund wire, its caps and its numbering`
2. `feat(api): a resalable return posts stock; damaged goods post nothing`
3. `feat(api): the credit portion of a refund reduces the ledger`
4. `feat(api): REFUND joins the approval registry and the boot lists`
5. `feat(api): electronic refunds dispatch after commit and settle by webhook`
6. `test(api): per-line and per-tender caps, approval boundary and immutable sale`

## Done when

- A refund is a document nobody can exceed, by line, by tender, or by the sale's kept money.
- `REFUND` is decided in the same inbox as everything else, and the decision cannot change a figure.
- Damaged goods never move stock, and resalable ones do.
- The sale a customer is disputing is exactly as it was taken.
