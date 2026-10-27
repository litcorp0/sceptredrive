---
phase: 13-pos-payments-returns
plan: 10
title: Refunds and credit repayment at the till
lane: desktop
depends_on: [09, 05, 06]
requirements: [POS-10, POS-12, PAY-03]
---

# Plan 10 — Give the money back, and take the money in

## Goal

A cashier finds a receipt on this till, picks the lines coming back, says what happens to the goods,
allocates the refund across the tenders that were actually taken, and gets a manager's PIN. The
refund is written locally, printed, and uploaded — offline if need be. The same screen family takes a
credit repayment, in cash offline or by MoMo when the network is there.

## Read first

- `00-DECISIONS.md` P13-D17 … P13-D27.
- Plan 05's `applyRefund` (the server's mirror of this arithmetic) and Plan 06's `applyRepayment`.
- `desktop/src/renderer/lib/refund-*` — does not exist; this plan creates it.
- `desktop/src/renderer/lib/overrides/override-service.ts:25-27,79-116` — `OverridePermission` and
  `approveOverride`; extend the union with `'pos.refund'`.
- `desktop/src/renderer/lib/sale/sale-repository.ts` — `listSalesBetween`, `findSale`,
  `listSaleTenders`, and the query the refund lookup needs.
- `desktop/src/renderer/lib/receipt/render.ts` and `print-sale.ts` — the receipt contract.
- `desktop/src/renderer/lib/document-sequence.ts` — `nextDocumentValue`, for `RF-…`.

## Tasks

### 1. Refund lookup

`lib/refund/refund-repository.ts`:

```ts
export async function searchRefundableSales(db, input: { query: string; limit?: number }): Promise<SaleSearchRow[]>
export async function loadRefundDraft(db, saleId: string): Promise<RefundSource>
```

- `query` matches a receipt number (exact or prefix) or a customer phone, over **this terminal's**
  sales (P13-D25), most recent first, limit 20.
- `RefundSource` carries the sale's lines with `alreadyRefundedQuantity`, its tenders with
  `alreadyRefundedMinor`, `totalMinor`, `changeMinor`, `occurredAt` and `customerName`.
- A sale with nothing left refundable is shown greyed with the reason, not hidden — a cashier needs to
  know it was already refunded, not to wonder where it went.

### 2. The refund document, locally

`lib/refund/refund-service.ts`:

```ts
export interface RefundInput {
  saleId: string
  lines: Array<{ saleLineId: string; quantity: number; restock: RefundRestock; damageReason?: string | null }>
  tenders: Array<{ saleTenderId: string; amountMinor: number }>
  reasonCode: RefundReason
  note?: string | null
  approval: CartOverrideProof
}
export async function createRefund(db, input: RefundInput): Promise<{ refundId; number; refundedMinor }>
```

One `db.writeTransaction`:

1. re-read the source under the same invariants the server uses (`refundableQuantity`,
   `refundableTenderMinor`, `refundAllocationProblem`) — the server is authoritative, but a till that
   can produce an impossible refund is a till that uploads a refusal;
2. allocate `RF-<terminalCode>-<accraDay>-NNNN` through `nextDocumentValue` **inside** the
   transaction;
3. allocate each line's money components with `allocateProportionally` weighted
   `[requested, remaining]`, the same way Plan 05 does;
4. write `refund`, `refund_line`, `refund_tender`, and `local_stock_delta` rows for `RESALABLE`
   lines only (`+quantity`);
5. write the `REFUND` outbox row;
6. `notifyOutboxChanged()` **after** the transaction.

Electronic `refund_tender` rows are written `PENDING` locally and are **not** sent to the payment
client: the server dispatches the provider refund (P13-D26), so the till never calls Paystack for a
refund. That is what keeps one write path.

### 3. The refund screen

Route `#/refund` (`routes/refund.tsx` → `modules/refund/pages/refund-page.tsx`), reached from the
shift home and from a receipt.

1. **Find**: a scan-or-type field (`data-testid="refund-search"`), results list with receipt number,
   time, total and what is left.
2. **Pick lines**: quantity stepper capped at the remainder, a `RESALABLE | DAMAGED | NOT_RETURNED`
   segmented control per line, and a reason box that appears for `DAMAGED`.
3. **Allocate**: the tenders that were taken, each with its remainder and an amount field; a
   **Fill remaining** button that distributes the refund over the remainders in tender order. Credit
   rows are labelled "reduces the account — no cash"; electronic rows "goes back to the card/MoMo".
4. **Reason**: the shared `REFUND_REASONS` with the `OTHER` note rule.
5. **Authorise**: `ManagerOverrideDialog permission="pos.refund"`; the summary above it names the
   amount and the tenders. No bypass button for a refund — `onBypass` is not passed.
6. **Confirm**: writes locally, prints the refund receipt, navigates to it.

Offline, the screen is complete and the electronic rows read "will be sent when the network is back";
the till does not pretend a card refund is settled.

### 4. The refund receipt

`render.ts` gains `buildRefundReceiptModel` and the print path gains `printRefund`. The document
carries: `*** REFUND ***`, the original receipt number, the reason, each line with quantity and
restock, the tenders refunded with their status, `TOTAL REFUNDED`, the manager's staff id, and the
E-VAT slots still `null`. A reprint is marked as one (P13-D11's receipt contract).

`print-sale.ts` is split so `printDocument` takes either model; `sale.print_status` logic is
untouched, and the refund's own print status lives on the **outbox-independent** local row
(`refund.print_status` etc. are not added — a refund that fails to print is reprinted from the refund
screen, and the phase does not add a second print queue).

### 5. Credit repayment at the till

Route `#/repayment`:

1. Customer by phone or name (the synced `customer` + `credit_profile`); the panel shows limit,
   balance, headroom, and a hold badge.
2. Amount (keypad, integer pesewas), method `CASH | MOMO`.
3. MoMo uses Plan 09's payment client with `method: 'MOMO'`; the payload's `paymentId` is the paid
   payment.
4. A held profile shows "This account is on hold — a manager must approve taking money" and opens the
   `credit.override` dialog.
5. Writes `local_credit_delta` (negative for the repayment — check the sign convention the balance
   projection uses), the `CREDIT_REPAYMENT` outbox row, prints a repayment receipt carrying the
   till's own `RP-…` number, and shows the new headroom.

`local_credit_delta` today only ever holds positive sale amounts (`sale-repository.ts:362`); the
delta reader must sum signed values, and a test asserts that a 50.00 repayment reduces the cached
balance by exactly 50.00 before the upload acks.

### 6. Navigation

`modules/home` gains two actions (Refund, Take a repayment), the sidebar/command palette gain the
routes, and the sell screen's header gains a **Refund** action. Every new control is reachable by
keyboard and has a visible focus ring (Phase 10's audit rules).

### 7. Tests (`desktop`)

- `refund-service.test.ts`: caps (a third unit of a two-unit line is refused), component allocation
  (a full-line refund equals the line's stored figures), the number is allocated inside the
  transaction and a rolled-back refund does not burn it, `RESALABLE` writes a `+qty` local delta and
  `DAMAGED` writes none, the outbox row is `REFUND` with the sale id and tenders.
- `refund-search.test.ts`: finds by receipt, finds by phone, never returns another terminal's sale,
  marks a fully refunded sale as such.
- `repayment.test.ts`: cash writes a negative `local_credit_delta` and a `CREDIT_REPAYMENT` outbox row;
  MoMo requires a `PAID` payment; the headroom display uses the signed sum.
- `render.test.ts`: the refund receipt contains the original number, the reason, each line and each
  tender; the sale receipt is byte-identical to Plan 08's fixture.
- `override-service.test.ts`: `pos.refund` is in `reasonCodesFor` and a cashier binding is refused.

## Verification

```bash
bun run --filter desktop test
bun run --filter desktop check-types
bun run test:counter          # the counter audit still drives the sell → tender → receipt path
bun run lint
```

Expected: desktop **~485 → ~520**.

## Commits

1. `feat(desktop): a refund is written, numbered and printed on the till`
2. `feat(desktop): per-line restock and per-tender allocation screens`
3. `feat(desktop): pos.refund is a manager's authority`
4. `feat(desktop): a repayment is a signed credit delta and its own receipt`
5. `test(desktop): caps, allocation, the number and the signed balance`

## Done when

- A cash refund completes with the cable out, prints, and uploads later.
- A refund cannot exceed a line, a tender, or the money the shop kept.
- A refunded card tender is shown as pending, never as paid.
- A repayment reduces the cached balance immediately and reconciles on sync.
