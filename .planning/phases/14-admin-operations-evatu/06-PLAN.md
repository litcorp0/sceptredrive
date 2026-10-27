---
phase: 14-admin-operations-evatu
plan: 06
title: Supplier transfers — recipients, initiation, OTP, webhook, settlement
lane: api
depends_on: [02]
requirements: [PAY-04, PAY-05, PAY-06]
---

# Plan 06 — A supplier is paid when the money moved

## Goal

A manager can pay a supplier through Paystack from the Paystack balance: we create the
recipient for the bank account or MoMo number on file, initiate the transfer, handle the
OTP if the account requires one, and post exactly one `supplier_payment` when
`transfer.success` arrives. A failed, reversed or blocked transfer posts nothing; the
attempt stays visible. Manual payment is untouched and still works with Paystack
unreachable.

## Read first

- `00-DECISIONS.md` P14-D8, D22–D32, D46, D47.
- `01-RESEARCH.md` facts 1–7, 35–41 (the seam, the event ledger, the payment pair).
- `api/src/modules/payments/payments.provider.ts:16-110` — the interface, the result
  types, `ProviderUnavailableError`, the cached factory.
- `api/src/modules/payments/payments.paystack.provider.ts:299-365` — `request()`, the
  logging rule, the 20 s timeout, the `>=500` rule.
- `api/src/modules/payments/payments.mock.provider.ts:40-249` — state maps, harness hooks.
- `api/src/modules/payments/payments.service.ts:55-230` — the webhook, its idempotency
  table and `applyProviderCharge`; `:697-833` — signature and event storage.
- `api/src/modules/payables/payables.service.ts:612-770` — `createPayment` in full, the
  function this plan splits.
- `api/src/modules/payables/payables.schema.ts:34-45`, `:156-226`.
- `api/src/modules/suppliers/suppliers.schema.ts:55-96`, `suppliers.service.ts:347-510`.
- `api/src/jobs/queues.ts:39-48`, `:114-142` — the sweep pattern.
- `api/src/app.ts:75-78` — the webhook mount before `loadSession`.

## Tasks

### 1. The seam grows four methods

`payments.provider.ts`:

```ts
export interface TransferRecipientInput {
  type: 'ghipss' | 'mobile_money'
  name: string
  accountNumber: string
  bankCode: string            // GHIPSS code, or MTN | VOD | ATL
  currency: 'GHS'
}

export interface ProviderTransferInput {
  reference: string
  amountMinor: number
  recipientCode: string
  reason: string
  currency: 'GHS'
}

export type ProviderTransferStatus =
  | 'pending' | 'otp' | 'success' | 'failed' | 'reversed' | 'blocked' | 'rejected'

export interface ProviderTransferResult {
  reference: string
  status: ProviderTransferStatus
  transferCode: string | null
  transferId: string | null      // u64 as a string, never a JS number
  amountMinor: number
  currency: string
  failureCode: string | null
  failureMessage: string | null
  transferredAt: string | null
  feeMinor: number | null
}
```

`PaymentProvider` gains `createTransferRecipient`, `initiateTransfer`,
`finalizeTransfer({ transferCode, otp })`, `verifyTransfer(reference)` and `getBalance()`.
The two provider classes implement them; `getBalance()` returns
`{ currency: 'GHS', balanceMinor }` or null when GHS is absent.

Paystack mapping: `POST /transferrecipient` (`:1`), `POST /transfer`
(`source: 'balance'`, `currency: 'GHS'`), `POST /transfer/finalize_transfer`,
`GET /transfer/verify/:reference`, `GET /balance`. Reference minting stays in the service:
`sdt-<uuid>` — 40 chars, lowercase, digits and dash, inside Paystack's 16–50 alphabet.

The mock: creates recipients deterministically from the account number, and models the
path test mode *does not* take — initiate returns `pending`, and a harness hook
(`settleMockTransfer(reference, status)`) moves it to `success`/`failed`/`reversed` so the
webhook arm is exercised locally (research fact 4). A second hook
(`requestMockOtp(reference)`) makes the next initiate return `otp`.

### 2. `supplier_payment_detail` gets a writer — and a forgetter

- `suppliers.service.ts` gains `ensurePaystackRecipient(detailId, executor)` calling the
  provider and storing `paystack_recipient_code`. It is called from the transfer path, not
  from the detail form.
- `updatePaymentDetail` **clears** `paystackRecipientCode` whenever `method`,
  `accountNumber`, `bankCode`, `bankName`, `momoNetwork` or `phone` changes, and audits
  `supplier.payment_detail.recipient_cleared`. A stale recipient is money sent to a closed
  account (P14-D27).
- `SupplierPaymentDetailView` gains `recipientReady: boolean`. The code itself stays out of
  every response, as it is today.

### 3. `POST /api/payables/transfers`

Body (`.strict()`): `{ supplierId, branchId?, paymentDetailId, amountMinor,
allocations?: [{ invoiceId, amountMinor }], note?, idempotencyKey }`. `payable.transfer`.

Order of operations, all before any provider call:

1. Branch from `resolveBranchFilter`/`input.branchId`; `assertBranchAccess`.
2. The payment detail must exist, belong to the supplier, be active, and be `BANK` or
   `MOMO`. A `CASH` detail is refused — there is no Paystack cash transfer.
3. Amount is a positive safe integer; allocations are positive, one per invoice, and
   `Σ allocations ≤ amount`.
4. Idempotency: `(branch_id, idempotency_key)` is checked first and returned if found
   (the same pre-check the manual payment does, `payables.service.ts:657-660`), with the
   unique violation as the backstop.
5. **Balance**: `getBalance()`; an insufficient balance is a `ConflictError`
   `INSUFFICIENT_PROVIDER_BALANCE` with both figures in the message, thrown **before** the
   transfer row exists.
6. Insert `supplier_transfer` (`PENDING`) + `supplier_transfer_allocation` rows, mint
   `reference`, audit `supplier_transfer.created`.
7. `ensurePaystackRecipient`, then `initiateTransfer`.
8. Persist the returned status: `pending` → `PENDING`, `otp` → `AWAITING_OTP`, `success` →
   settle (Task 5), `failed`/`blocked`/`rejected` → the mapped status with the failure
   words. Audit `supplier_transfer.initiated` with `{ reference, transferCode, status }`.
9. A `ProviderUnavailableError` leaves the row `PENDING` and returns it with
   `providerUnavailable: true` — the sweep will verify, and the console says "pending",
   which is true.

`POST /api/payables/transfers/:id/finalize` accepts `{ otp: /^\d{4,8}$/ }`, refuses unless
`status = 'AWAITING_OTP'`, calls `finalizeTransfer`, and persists the result. A wrong OTP is
Paystack's error, surfaced as a 400 with its message and **no** status change.

`POST /api/payables/transfers/:id/verify` is the manual refresh: one `verifyTransfer`, the
same state application, `payable.transfer`.

### 4. Settlement — one core, two callers

Extract from `createPayment`:

```ts
interface PostPaymentInput {
  branchId: string; supplierId: string; method: SupplierPaymentMethod
  amountMinor: number; paidAt: Date; paymentDetailId: string | null
  reference: string | null; note: string | null; idempotencyKey: string
  allocations: Array<{ invoiceId: string; amountMinor: number }>
}
async function postSupplierPaymentInTransaction(
  input: PostPaymentInput,
  actor: { createdBy: string },
  executor: Executor,
): Promise<SupplierPaymentRow>
```

It keeps every money rule: supplier ACTIVE, invoices locked `FOR UPDATE` in sorted id
order, same supplier, not `VOID`, remaining balance respected, `APPLY` allocations, invoice
projection recomputed, audit with `onAccountMinor`. It drops only the session-shaped checks
(branch access, the 5-minute clock skew), which the callers keep.

`createPayment` becomes: authorise → clock check → `postSupplierPaymentInTransaction` with
`createdBy = user.id`. The settlement calls it with `createdBy = 'system:paystack'` and
`idempotencyKey = 'transfer:<transferId>'`. **A parity test proves the same input produces
identical rows through both callers**, differing only in `created_by`.

Settlement itself (`payables.service.applyTransferEvent`):

1. Lock the transfer row.
2. If `payment_id` is already set, do nothing (replay).
3. Re-read each planned invoice's remaining balance. Keep what fits, drop what does not.
4. Post the payment with the surviving allocations; the difference becomes on-account and
   is written to `unallocated_minor`.
5. Set `payment_id`, `status = 'SUCCESS'`, `settled_at`.
6. Audit `supplier_transfer.settled` with `{ paymentId, plannedMinor, allocatedMinor,
   unallocatedMinor }`, and **only if** `unallocatedMinor > 0` also
   `supplier_transfer.allocation_shortfall` naming the invoices whose balance moved.

A shortfall is not a failure. The supplier has the money; the books say so; a person may
re-allocate. What must not happen is a settlement that throws and leaves a transfer whose
money is gone with no payment row.

### 5. Webhook arms

`payments.service.handleWebhook` gains `transfer.success`, `transfer.failed`,
`transfer.reversed` in `HANDLED_EVENTS`. The event is stored in `payment_event` with
`providerReference = data.reference`, `paymentId = null`, `supplierTransferId` resolved
from the reference, and the allowlisted projection. Then:

- `transfer.success` → `payables.service.applyTransferEvent(reference, 'success', data)`.
- `transfer.failed` / `transfer.reversed` → mark the transfer, audit
  `supplier_transfer.failed` / `.reversed`; **post nothing**; on `reversed` with an existing
  payment, raise the attention item (P14-D46).
- An event whose reference matches no transfer is `IGNORED` with a 200, exactly as an
  unknown charge reference is today.

`payments.service` imports `payables.service`; `payables.service` imports only
`payments.provider.ts`, never `payments.service.ts`. The import direction is deliberate and
a comment says so, because the other direction is a cycle.

### 6. The sweep

`api/src/jobs/queues.ts`: queue `payables-transfer-reconcile`, every 15 minutes,
Africa/Accra, `missed: 'once'`. It selects transfers in `PENDING`/`AWAITING_OTP` older than
10 minutes (limit 100), calls `verifyTransfer` for each through
`applyTransferEvent`-compatible code, and logs `{ transferId, status }` only. It never
finalises an OTP (P14-D47). An error for one transfer is logged and the loop continues —
one stranded transfer cannot hide the other 99.

### 7. Reads

- `GET /api/payables/transfers` — paged, `branchId`, `supplierId`, `status`, `from`, `to`;
  `payable.read`.
- `GET /api/payables/transfers/:id` — transfer, its plan, its payment (or null), the
  provider's failure words.
- `GET /api/payables/provider-balance` — `payable.transfer`; `{ currency: 'GHS',
  balanceMinor }` or `{ currency: 'GHS', balanceMinor: null }` when the provider is
  unreachable. The console reads it before offering a transfer, and the create path checks
  it again. Cached for 30 seconds in-process so opening a dialog is not a provider call per
  keystroke.
- `GET /api/payables/transfers/reconciliation?from=&to=&branchId=` — `payable.read`. One
  list with three states per row:
  - `manual` — a `supplier_payment` in the period with no transfer: the fallback working;
  - `settled` — a transfer with a payment: `amount` and `payment.amountMinor` equal by
    construction, and the row carries `unallocatedMinor`;
  - `unposted` — a transfer in `SUCCESS` with no payment (should be impossible, which is
    why it is visible) or a non-success transfer, with its status and failure code.
  Totals: `settledMinor`, `manualMinor`, `unpostedMinor`, `failedCount`, `reversedCount`.
  `payment.amountMinor` is the supplier's figure; `feeMinor` is reported separately and
  never netted (P14-D29).

### 8. Tests — `payables.transfer.test.ts`, `payables.transfer.webhook.test.ts`

Mock provider throughout, with `PAYSTACK_MODE=mock`; one test constructs the real client
against a stubbed `fetch` to prove the request bodies (`ghipss`, `mobile_money`, `source`,
`amount` in pesewas) and that the key never appears in a log line.

- create a recipient for a `BANK` detail → `ghipss` + `bank_code`; for `MOMO` → `MTN`;
- change the detail's account number → the code is cleared and the next transfer creates a
  new recipient; the audit row names the clear;
- initiate against a low mock balance → `INSUFFICIENT_PROVIDER_BALANCE`, **no transfer row**;
- initiate → `PENDING`; settle via the harbour hook → one `supplier_payment`, allocations
  applied, invoice statuses recomputed, `supplier_transfer.payment_id` set;
- the same webhook body twice → one `payment_event`, one payment, identical balances;
- a second transfer with the same `idempotencyKey` → the first transfer returned, no second
  provider call (`getMockCallCounts`);
- `otp`: initiate returns `AWAITING_OTP`, finalize with a wrong code changes nothing,
  finalize with the right one moves it to `PENDING` then `SUCCESS`;
- `transfer.failed` → status `FAILED`, **zero** payments, invoice balances unchanged;
- `transfer.reversed` after a success → status `REVERSED`, the payment still exists, the
  reconciliation shows the pair as attention, and `voidPayment` is the only path that
  reverses the ledger (prove it with one call and one audit row);
- an invoice paid by hand between plan and settlement → transfer succeeds, allocation
  shrinks, `unallocated_minor` is the difference, `allocation_shortfall` is audited;
- a `CASH` payment detail is refused; an inactive detail is refused; another branch's
  supplier is a 403; a cashier is a 403;
- the reconciliation lists one manual payment as `manual`, one settled transfer as
  `settled`, and computes `settledMinor` from `amountMinor` without a fee;
- a replay of a webhook for an unknown reference is `IGNORED` and 200.

## Verification

```bash
bun run --filter api test     # ~815 → ~870
bun run check-types
```

By hand against the mock: pay a 500 GHS invoice, watch the supplier balance fall by 500 and
not a pesewa more; fail a second transfer and watch the balance stay; reverse a third and
watch the payment survive until a manager voids it.

## Commits

1. `feat(api): the provider seam learns recipients, transfers, OTP and balance`
2. `feat(api): a transfer is an intent, and the payment is the fact`
3. `feat(api): transfer webhooks settle, fail and reverse without touching a balance twice`
4. `feat(api): the sweep verifies stragglers and never guesses an OTP`
5. `feat(api): a reconciliation view of manual payments, settled transfers and unposted money`
6. `test(api): the transfer lifecycle, the shortfall, the replay and the reversal`

## Done when

- A supplier's balance moves exactly when Paystack says the money moved.
- A failed transfer leaves the books exactly as they were.
- The reconciliation screen can name every transfer that did not become a payment.
