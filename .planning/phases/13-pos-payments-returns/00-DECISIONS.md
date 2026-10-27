# Phase 13 — Decisions

`00-CONTEXT.md` is the locked context. This file refines it and **wins where the two disagree**.
Every decision names where it is exercised, so a later reader can check the code rather than the
prose.

Five decisions were put to the operator on 2026-10-27 and answered; they are marked
**[operator]**. The rest were taken while planning because they are mechanical, fail-closed, or
forced by a verified fact in the repository or in the provider's documentation.

Six defects in the locked context were found by planning and are **resolved here rather than
implemented as written**: D2's pending-tender sentence (P13-D2), D5's "and the terminal is online"
(P13-D23), D5's "card refunds work offline" (P13-D24), D6's "posts the stock write-off path"
(P13-D22), D17's "re-prices … recomputes loyalty" (P13-D35), and D19's shift-scoped framing against
D16's terminal scope (P13-D30).

---

## A. The money model

### P13-D1 — Five tender methods; the ordinal becomes part of the key

`sale_tender_method` gains `MOMO`, `CARD`, `BANK_TRANSFER`. `sale_tender` gains
`sequence integer not null default 1`, and the unique index
`sale_tender_sale_method_unique (sale_id, method)` is **replaced** by
`sale_tender_sale_sequence_unique (sale_id, sequence)`.

A sale may carry one cash tender, at most one credit tender, and any number of electronic tenders,
including two of the same method. Capping at five tenders overall is a UX and payload limit
(`sync.validation.ts` `.max(5)`), not a database rule.

Exercised in: Plan 02 (enum-only migration + DDL), Plan 04 (validation and writes), Plan 08
(tender builder).

**Why `sequence` and not `(sale_id, method, sequence)`:** the method is already on the row, so a
three-column key permits exactly what a two-column key permits. The sequence is what makes the
receipt deterministic — a customer who pays GH₵50 cash then GH₵50 MoMo should see them in that
order.

### P13-D2 — A tender on a sale is settled; there is no `sale_tender.status`

Context D2 says "electronic tenders carry `PENDING → PAID | FAILED | ABANDONED | EXPIRED`" and, in
the same breath, "the sale row is written once, at completion". Both cannot be true of the same
row. **The status lives on the payment, not on the tender.** Once a sale exists, every tender on it
is money that was received; a pending payment is a payment, not a sale.

The sale is therefore final at upload, and `applySale` refuses any tender that does not reconcile
(P13-D5). `PENDING`, `FAILED`, `ABANDONED` and `EXPIRED` are `payment.status` values (P13-D6).

Exercised in: Plan 02 (`payment.status`), Plan 03 (provider flows), Plan 04 (assertions).

### P13-D3 — Tender arithmetic is shared, and change comes only from cash

`packages/shared/src/tender.ts` (new) exports the only tender arithmetic in the product:

```ts
export const TENDER_METHODS = ['CASH','CREDIT','MOMO','CARD','BANK_TRANSFER'] as const
export type TenderMethod = (typeof TENDER_METHODS)[number]
export const ELECTRONIC_TENDER_METHODS = ['MOMO','CARD','BANK_TRANSFER'] as const

export interface TenderLine { method: TenderMethod; amountMinor: number; sequence: number }
export interface TenderBalance {
  totalMinor: number
  appliedMinor: number      // Σ tenders
  cashMinor: number         // Σ CASH
  creditMinor: number       // Σ CREDIT
  electronicMinor: number
  remainingMinor: number    // max(0, total − applied)
  changeMinor: number       // max(0, applied − total), clamped to cashMinor
  problem: TenderProblem | null
}
export type TenderProblem =
  | 'OVERPAID_BY_ELECTRONIC'   // applied − total > cashMinor
  | 'CREDIT_EXCEEDS_TOTAL'
  | 'MULTIPLE_CREDIT_TENDERS'
  | 'NEGATIVE_TENDER'
  | 'TOO_MANY_TENDERS'
  | 'UNPAID_BALANCE'

export function tenderBalance(totalMinor: number, tenders: readonly TenderLine[]): TenderBalance
export function changeFromCash(totalMinor: number, tenders: readonly TenderLine[]): number
export function formatTenderLabel(method: TenderMethod): string
```

Rules, in one place:

- `change = max(0, Σ tenders − total)`, and it **may not exceed the cash tender's amount**. A card
  or a credit tender can never produce change (context D8).
- Credit must be a single tender and may not exceed the total.
- Every tender is a positive integer; a zero-total sale carries no tenders.
- `Σ tenders − change === total` is the identity both the till and the server assert.

Exercised in: Plan 01 (function + tests), Plan 04 (server assertion), Plan 08 (UI).

**Why not in `pos.ts`:** `pos.ts` is the pricing engine both clients already share and its header
documents a single responsibility. Tender arithmetic changes daily in this phase; the pricing engine
must not.

### P13-D4 — A credit tender is bounded by headroom that already counts offline commitments

The credit portion is `sale.credit_amount_minor` and must equal the sum of the credit tenders. The
till's check is `creditHeadroom(snapshot) − (other credit already in this cart)`, where
`headroom = limit − (balance + pendingMinor)` and `pendingMinor` is the sum of unacked
`local_credit_delta` rows. The server re-derives limit and balance and records
`CREDIT_OVER_LIMIT`/`CREDIT_HOLD` as conflicts when the split pushes the sale over — it does not
refuse the sale, because the money has already been taken at the till (AGENTS.md rule: never block
a sale).

The manager override (`credit.override` PIN proof) authorises the credit **portion**, and is
validated once per sale even when the credit tender is the second of three.

Exercised in: Plan 01 (headroom helper unchanged, split-aware), Plan 04 (server), Plan 08 (UI).

### P13-D5 — The sale is written once, and only when the tenders cover it

The till writes the `sale` row only when `tenderBalance(total, tenders).problem === null` — i.e.
`Σ tenders − change === total`. There is no partially paid sale anywhere in the system, local or
server, and no `sale.status` column.

The server asserts the same identity and rejects (`INVALID_TENDER`) rather than repairing. A
mismatch is a client bug, not a business conflict: repairing it would invent a payment.

Exercised in: Plan 04, Plan 08, Plan 09.

### P13-D6 — An electronic tender is a server `payment`, created before the sale

The till cannot settle a MoMo charge itself, so the unit of electronic money is a **`payment`**
row, created by a device-authenticated call before any sale exists:

```
clientPaymentId (uuidv7, minted by the till)
   → POST /api/pos/payments            → payment PENDING + provider response
   → GET  /api/pos/payments/:id        → PENDING | PAID | FAILED | EXPIRED
   → sale completes locally, referencing payment_id
   → SALE upload references the same payment_id
```

`payment` is unique on `(terminal_id, client_payment_id)` **and** on `provider_reference`. The sale
tender references it by foreign key; `applySale` requires:

- the payment exists, belongs to the same terminal and branch, and has the same `shift_id`;
- `payment.status === 'PAID'` and `payment.amount_minor === tender.amount_minor`;
- the payment is not already referenced by another `sale_tender` (one payment, one tender —
  otherwise a reload could spend GH₵50 twice).

A payment that is `PAID` but unreferenced after the day is an **orphan** (P13-D9).

Exercised in: Plan 02 (table), Plan 03 (endpoints), Plan 04 (assertions).

### P13-D7 — Paystack needs an email; the till synthesises a routing label, never a contact

`email` is required on every charge and initialize call and a walk-in customer has none.
`payment.provider_email` is written as
`pos+<terminalCode>-<clientPaymentId>@<PAYSTACK_EMAIL_DOMAIN>`, where the domain is an
environment variable (default `sceptre-drive.example`).

It is a **routing label**, not a contact channel: we never send mail to it, never show it, and
never accept one from a customer. Phase 15's go-live checklist gains one line: point
`PAYSTACK_EMAIL_DOMAIN` at a domain the business owns, because a provider that validates
deliverability would reject `.example`.

Exercised in: Plan 03 (`providerEmail`), Plan 13 (gates).

### P13-D8 — MoMo has 180 seconds, and the till is the one that decides

`POST /charge` returns `pay_offline`; the network kills the attempt after 180 s; settlement arrives
on the webhook. The till polls `GET /api/pos/payments/:id` every 3 s up to the payment's
`expires_at` (180 s from creation). At expiry it calls `POST /api/pos/payments/:id/abandon`, which:

- flips `PENDING → EXPIRED` (idempotent; `PAID` is never downgraded);
- asks the provider to verify once, because the webhook may simply be late. A verification that
  returns `success` inside that call wins and the payment becomes `PAID`;
- leaves the sale open with its other tenders intact, so the cashier retries or switches to cash.

`payment_status` is a one-way ladder for failure (`PENDING → FAILED|EXPIRED|ABANDONED`) and a
two-way door only for `PAID`, which a late webhook may still reach (P13-D9).

Exercised in: Plan 03 (abandon + verify), Plan 09 (poll/expiry), Plan 13 (walkthrough legs).

### P13-D9 — A payment that settles after abandonment is never auto-refunded

The customer approving on their handset 20 seconds after the cashier gave up is a real event. The
`charge.success` webhook still arrives. The server records:

- `payment.status = 'PAID'`, `payment.orphaned = true`;
- one `sync_conflict` of the new type `PAYMENT_LATE_SETTLEMENT` at **HIGH**, naming the terminal,
  the amount and the provider reference;
- **no automatic refund.** Reversing a customer's money without a person deciding it is exactly the
  kind of automation this repository does not do.

The till shows a persistent "Payment received without a sale — GH₵50.00 MoMo, 14:32" banner on the
shift home. A manager may attach it to the current cart (if the amount still fits the remaining
balance) or record it for refund; the attach path is
`POST /api/pos/payments/:id/claim` and it simply clears `orphaned` when a sale tender references it.

Exercised in: Plan 03 (webhook branch), Plan 09 (banner), Plan 13 (leg).

---

## B. Electronic payments

### P13-D10 — One provider interface, two implementations, selected by environment

`api/src/modules/payments/payments.provider.ts`:

```ts
export interface PaymentProvider {
  readonly name: 'PAYSTACK' | 'MOCK'
  createMobileMoneyCharge(input: ChargeInput): Promise<ProviderChargeResult>
  createCardCheckout(input: ChargeInput): Promise<ProviderChargeResult>
  createBankTransferCharge(input: ChargeInput): Promise<ProviderChargeResult>
  verify(reference: string): Promise<ProviderVerification>
  refund(input: { reference: string; amountMinor: number; note: string }): Promise<ProviderRefund>
}
```

`PAYSTACK_MODE` is `mock | test | live` (default `mock`). `mock` selects `MockPaymentProvider`;
`test`/`live` select `PaystackPaymentProvider` with the secret key and the mode's base URL. The
interface is the seam the tests use; nothing above it knows which implementation is live except the
factory, and the factory refuses to start when `mode !== 'mock'` and the key is absent.

Exercised in: Plan 03, Plan 13 (mock walkthrough).

### P13-D11 — The webhook is unauthenticated, verified before parsing, and idempotent by body hash

`POST /api/payments/webhook/paystack`:

1. Read `c.req.text()` **once** — the HMAC is over the raw bytes, and a re-serialised body will not
   match.
2. `HMAC-SHA512(rawBody, PAYSTACK_WEBHOOK_SECRET)` compared to `x-paystack-signature` with
   `timingSafeEqual` on equal-length buffers. Mismatch → **401**, nothing logged but the fact.
3. `payment_event(provider, body_sha256)` unique; a duplicate delivery inserts nothing and returns
   200. Paystack retries every 3 minutes for four attempts then hourly for 72 hours, so this is the
   normal case, not the exception.
4. Apply the state change in one transaction, then return **200** with `{ received: true }`. No
   long work, no queue for the settlement itself — the till is waiting on it.

`x-paystack-signature` is the only credential; the route carries **no** session and **no** device
JWT, so it is excluded from both auth middlewares explicitly and is the only unauthenticated
mutating route in the API (documented in the OWASP table).

Exercised in: Plan 03, Plan 13 (replay leg).

### P13-D12 — Verify is the fallback, and it is rate-limited on our side

`GET /transaction/verify/:reference` is called (a) by the expiry path in P13-D8, (b) by
`GET /api/pos/payments/:id?refresh=1` when the stored record is `PENDING` and
`now − last_verified_at ≥ 5 s`, and (c) by the nightly reconciliation of `PENDING` payments older
than 10 minutes. Each call updates `last_verified_at` before the HTTP request so a hammering client
cannot turn our API into a Paystack quota sink.

A verification whose `data.amount` differs from `payment.amount_minor` sets
`PAYMENT_AMOUNT_MISMATCH` (HIGH) and does **not** mark the payment paid — Paystack's own guidance is
to verify the amount as well as the status.

Exercised in: Plan 03, Plan 07 (nightly job).

### P13-D13 — Card goes through Paystack Checkout, in a locked-down window **[operator]**

The Card Charge API needs a PCI-DSS AOC/RoC we do not have, so the card tender is
`POST /transaction/initialize` with `channels: ['card']`, and the till shows the `authorization_url`
in a **separate** Electron `BrowserWindow` created by the main process:

```
sandbox: true, contextIsolation: true, nodeIntegration: false, no preload,
webSecurity: true, partition: 'persist:paystack-checkout'
```

Navigation is restricted to `https://checkout.paystack.com` and `https://paystack.com`;
`setWindowOpenHandler` denies everything and routes `shell.openExternal` only through a scheme and
host allowlist. The window is closed by the main process when the payment reaches a terminal state
or after `expires_at`. The renderer never loads the checkout, never sees a card field, and never
asserts success; the server learns the outcome from the webhook or verify.

Exercised in: Plan 03 (initialize), Plan 09 (main-process window + IPC), Plan 13 (security gate).

### P13-D14 — Bank transfer is Pay-with-Transfer, displayed, not emailed

`POST /charge` with `bank_transfer.account_expires_at = now + 15 min` returns `pending_bank_transfer`
with `account_number`, `account_name` and `bank`. The tender screen shows all three at a size a
customer can read across the counter, plus a countdown. The payment expires with the account, and
the `bank.transfer.rejected` event (wrong amount) maps to `FAILED` with a `failed_message` the till
shows verbatim.

Exercised in: Plan 03, Plan 09.

### P13-D15 — We store what we need and nothing else

`payment` keeps: our reference, the provider transaction id (as **text**, because it is a u64), the
amount, the channel, the status, the bank-transfer account fields, and no card data at all — not
`bin`, not `last4`, not `authorization`. The raw provider response is **not** persisted; the
`payment_event` `detail` column is an allowlisted projection (`reference`, `status`, `amount`,
`currency`, `channel`, `paid_at`, `gateway_response`). Secrets, tokens and full bodies never reach
pino, the local SQLite file, or the audit trail.

Exercised in: Plan 03 (DTO + projection), Plan 13 (OWASP leg + log grep).

### P13-D16 — Provider calls that must not block a transaction run in a job

Two paths call a provider outside the request that decided them:

| Work | Why a job | Queue |
|---|---|---|
| Electronic refund dispatch (P13-D26) | the refund document is written in the upload transaction; an HTTP call cannot be inside it | `pos-refund-dispatch` |
| Stale `PENDING` payment reconciliation | 10-minute sweep, once a night, cheap | `pos-payment-reconcile` |

Both jobs are idempotent: the refund job re-reads `refund_tender.status` and does nothing unless it
is `PENDING`; the reconcile job only touches rows older than 10 minutes. A job that fails five times
leaves the row visibly `PENDING`, which Phase 14's console already knows how to display.

Exercised in: Plan 05 (refund job), Plan 07 (reconcile), Plan 02 (queue names in `jobs/queues.ts`).

---

## C. Refunds

### P13-D17 — A refund is a new document, numbered, and the sale is never edited

Tables `refund`, `refund_line`, `refund_tender` (Plan 02). A refund:

- references one sale and one `sale_line` per line, capped at
  `sale_line.quantity − Σ refunded quantity for that line`;
- is numbered `RF-<terminalCode>-<day>-NNNN` from the till's local `document_sequence` and stored
  with `unique(refund.number)` — the same shape as a receipt, so a customer can be given a paper
  trail;
- carries its own tax reversal computed through `taxBreakdown`, never by multiplying by 0.2;
- never writes to `sale`, `sale_line` or `sale_tender`. "Partially refunded" is a derived sum.

Exercised in: Plan 02, Plan 05, Plan 10.

### P13-D18 — The till uploads refunds as an outbox type, not a POST

Cash refunds happen with the network unplugged, so the refund cannot be created by an HTTP call.
`REFUND` joins `OUTBOX_TYPES` and `UploadTransactionType`, and `dispatchTransaction` gains an arm
that calls `applyRefund` with the same `DbExecutor` contract as every other POS path.

`refund.id === clientTransactionId`, mirroring `sale.id`, so a replay collides on the primary key
even before `pos_sync_transaction` dedupes.

Exercised in: Plan 04 (union), Plan 05 (apply), Plan 10 (till).

### P13-D19 — Refunds are allocated per tender, chosen by the cashier **[operator]**

Every `sale_tender` has a refundable remainder: its `amount_minor` minus the sum of `refund_tender`
rows already booked against it. The till shows the remainders and the cashier allocates the refund
across them; the server enforces:

```
Σ refund_tender.amount for a sale_tender  ≤  sale_tender.amount_minor
Σ refund_tender.amount                     =  refund.refunded_minor
Σ over all refunds of the sale             ≤  sale.tender_total_minor − sale.change_minor
```

The last line is the one that matters: `change_minor` was never money we kept, so it is not
refundable. The cap check runs under `SELECT … FOR UPDATE` on the sale row, which serialises two
tills refunding the same sale at once.

Cash rows are `SETTLED` immediately. Credit rows are `SETTLED` and post a credit entry
(P13-D20). Electronic rows start `PENDING` (P13-D26).

Exercised in: Plan 01 (cap arithmetic + tests), Plan 05 (locking + writes), Plan 10 (picker UI).

### P13-D20 — Refunding a credit tender reduces the ledger and pays no cash **[operator]**

A refund against a credit tender posts a `credit_ledger_entry` of kind `REFUND` with
`amountMinor = −creditPortion`, `reasonCode = 'RETURN'`, `referenceType = 'REFUND'`,
`referenceId = refund.id`, `idempotencyKey = '<refundId>:credit'`. The customer never handed over
that money, so nothing leaves the drawer; the debt simply shrinks.

A customer who wants cash back against a settled debt is a **repayment reversal**, which is a
different decision with a different audit trail and is not part of this phase.

Exercised in: Plan 05 (posting), Plan 10 (copy that says so).

### P13-D21 — The approval threshold is the gross refund on one document **[operator]**

`pos.refundApprovalThresholdMinor` (default `20_000`, GHS 200, branch-overridable, admin-writable)
is compared to `refund.refunded_minor` — tax included, what the customer actually gets. It does not
accumulate across refunds of the same sale: five GH₵150 refunds on one receipt raise no approval.
`>=` triggers, so a refund of exactly GH₵200 raises one.

Exercised in: Plan 05 (`>=`), Plan 13 (boundary mutation).

### P13-D22 — `DAMAGED` refunds post **no** stock movement

Context D6 says a `DAMAGED` line "records a write-off reason and posts the stock write-off path from
Phase 12". That would double-decrement: the sale already removed the unit, and a write-off posts a
**negative** movement. The goods never came back into stock, so there is nothing to write off.

The rule is therefore per line (`refund_line.restock`):

| `restock` | Stock movement | Record |
|---|---|---|
| `RESALABLE` | **+quantity**, `type = 'RETURN'`, `reference = 'REFUND'` | the line returns to sellable stock |
| `DAMAGED` | **none** | `damage_reason` is required and stored on the line; the value is reported as damage, not as stock |
| `NOT_RETURNED` | **none** | the customer kept the goods; the sale stands |

`stock_movement_type` and `stock_movement_reference` gain `RETURN` / `REFUND` in the enum-only
migration. `DAMAGED` is the only variant that requires a reason.

Exercised in: Plan 01 (`restock` enum + reason validation), Plan 02 (enums), Plan 05 (posting),
Plan 13 (ledger reconciliation).

### P13-D23 — The approval is raised server-side, online or on sync

Context D5 conditions the retrospective `REFUND` approval on "the terminal is online". That condition
buys nothing: the approval is created by `applyRefund` on the server, which only ever runs when the
upload arrives — and an upload **is** connectivity. An offline refund therefore raises its approval
at the moment it syncs, which is exactly "retrospectively" as the operator intended.

The till is never blocked and never learns whether an approval exists (APR-06 holds).

`REFUND` is registered with `deciderRole = 'ADMIN'` and `deciderBranchId = null`: a refund at that
size is head-office's decision wherever the branch is. The **requester** is the cashier who took it.

Exercised in: Plan 05 (registration + boot lists), Plan 13 (walkthrough).

### P13-D24 — Refund authority is the manager PIN, checked twice

Offline, the cashier cannot refund without a manager: `approveOverride(db, { permission:
'pos.refund', … })` returns a `CartOverrideProof` bound to a binding id and `pinVersion`. It is
placed in the refund payload. `applyRefund` validates it with the existing
`validateOverrideProof(executor, device, proof, 'pos.refund')`, which checks the binding is live,
the pin version matches, the approver's role can hold the permission, and the approver is not the
uploader.

Online, an electronic refund additionally requires the payment to be `PAID` and the amount to fit
the payment's remainder — the PIN proves authority, never the amount.

`PERMISSIONS` gains `pos.refund` (ADMIN, MANAGER). `CASHIER` stays empty (P13-D36).

**Defect in D5:** "Cash and card refunds are authorised by the PIN … and work offline" contradicts
D12. Cash works offline; card and MoMo do not, because Paystack is the only one who can move that
money. The PIN is what makes an offline **cash** refund possible.

Exercised in: Plan 01 (permission + `OverridePermission`), Plan 05 (validation), Plan 10 (dialog).

### P13-D25 — Refund scope is a sale this terminal recorded

The till refunds from its own `sale` rows, found by receipt number, date or customer. A sale taken
on another terminal is **not** refundable at this till in v1: the till has no local copy of its
tenders, and the stock/credit deltas it would have to unwind are not local facts.

An online lookup that names the other terminal is the honest message ("that receipt was taken at
TILL-02; a manager must refund it from the console"), and the console path is Phase 14's. This is a
recorded limit, not an oversight.

Exercised in: Plan 10 (lookup + copy), Plan 13 (§6 limits).

### P13-D26 — Electronic refunds are dispatched after commit and settle by webhook

A refund with an electronic `refund_tender` writes it as `PENDING` and enqueues
`pos-refund-dispatch`. The job calls `provider.refund({ reference: payment.provider_reference,
amountMinor, note })`, stores `provider_refund_reference`, and leaves the status `PENDING`.
`refund.pending` / `refund.processing` / `refund.processed` / `refund.failed` /
`refund.needs-attention` update it. A `failed` refund means Paystack credited **us**; the row stays
visible and a HIGH conflict tells a manager the customer has not been paid.

A refund with only cash and credit tenders never touches the provider and is `SETTLED` at write
time.

Exercised in: Plan 05 (job + webhook branch), Plan 10 (status copy), Plan 13 (leg).

---

## D. Repayment, cart void, held carts

### P13-D27 — A credit repayment at the till is a device-originated fact

`CREDIT_REPAYMENT` joins the outbox. The payload carries `customerId`, `amountMinor`, `method`
(`CASH` or `MOMO` — `BANK` is console-only), `paymentId` when electronic, and a PIN proof only when
the cashier records a repayment on a **held** account (see below).

The server posts through `credit.postEntryInTransaction(tx, actor, null, { kind: 'REPAYMENT',
amountMinor: −amount, method, referenceType: 'POS_REPAYMENT', referenceId, idempotencyKey:
'<id>:repayment' })` and prints a receipt from the till's local copy.

No PIN for a cash repayment: it reduces a debt and cannot create one. The one exception is a
repayment against a profile on `hold`, which needs `credit.override` — money against a held account
is how a hold gets quietly bypassed.

Exercised in: Plan 02 (type), Plan 06 (apply), Plan 10 (UI).

### P13-D28 — Cart void is a reason-coded fact with no PIN

`CART_VOID` joins the outbox and `pos_transaction_type`. `cart_void` stores branch, terminal,
device, shift, cashier, `occurredAt`, `receivedAt`, `reasonCode`, `note`, `itemCount`, `grossMinor`,
`label` and a `lines` jsonb snapshot. Reason codes:
`CUSTOMER_CHANGED_MIND | WRONG_ITEM | PRICE_DISPUTE | DUPLICATE_SCAN | CUSTOMER_LEFT | OTHER`;
`OTHER` requires a note of at least 3 characters.

No PIN: a cart carries no money, and a void that needed a manager would be a void that never gets
recorded — which is how shrink hides. The data exists so Phase 14 can report it.

The reason codes live in `packages/shared/src/cart-void.ts` with `CART_VOID_REASON_LABELS` so the
till and the future console cannot drift.

Exercised in: Plan 01 (codes), Plan 02 (table), Plan 06 (apply), Plan 12 (dialog).

### P13-D29 — Held carts are local-only tables, never `cart_draft` **[operator]**

`held_cart` and `held_cart_line` in the POS SQLite schema, `localOnly: true`:

```sql
held_cart(id, label, held_at, held_by_user_id, held_by_staff_id, shift_id,
          customer_id, customer_name, customer_phone, loyalty_redeem_points,
          sale_discount_minor, sale_discount_reason, sale_discount_note,
          sale_discount_override, subtotal_minor, total_minor, item_count)
held_cart_line(id, hold_id, line_number, product_id, sku, name, barcode,
               quantity, unit_price_minor, tax_category, line_discount_minor,
               line_discount_reason, line_discount_note, line_discount_override)
```

Rules: at most **10** holds per terminal, refused with a readable message; label required,
trimmed, 1–60 characters; holds are terminal-scoped and visible to every cashier on that terminal;
they survive restart and shift change because nothing prunes them by shift.

`cart_draft` keeps its single-active-draft invariant untouched; recall **deletes** the hold in the
same transaction that writes the recalled draft, so a hold cannot be recalled twice.

POS-15 says "on any terminal"; D16 says terminal-scoped. **D16 wins** and `REQUIREMENTS.md`'s
POS-15 wording is corrected in Plan 01's documentation commit.

Exercised in: Plan 02 (nothing — no server table), Plan 08 (local schema), Plan 12 (UI), Plan 13
(schema-migration proof).

### P13-D30 — A shift close asks about holds; it never deletes one silently

Context D19 is written as if holds were shift-scoped, while D16 makes them terminal-scoped. The
terminal scope is what survives the shift, so the close dialog is the only place the two meet:

- no holds → close proceeds;
- holds exist → the dialog lists them and requires a choice: **keep** (they stay for the next shift,
  `held_cart.shift_id` is left as the shift that created them, for history) or **void** (one
  `CART_VOID` per hold with `CUSTOMER_LEFT` and an automatic note naming the label);
- closing the shift is never blocked, and the choice is explicit.

Exercised in: Plan 12 (dialog + close flow).

### P13-D31 — A pending electronic tender survives a restart

`cart_tender` (local-only) holds the in-flight tenders of the draft:
`(id, draft_id, sequence, method, amount_minor, momo_provider, phone, payment_id,
provider_reference, status, display_text, expires_at, created_at)`. It is written in the same
150 ms debounce as the draft, so a crash during a 180-second MoMo authorisation does not lose the
fact that GH₵50 is in flight. On restart the tender screen resumes at the pending tender with its
remaining time; if it is already `PAID`, the cashier completes the sale.

`cart_tender` is cleared in the same transaction that writes `sale_tender` rows.

Exercised in: Plan 08 (schema + recovery), Plan 09 (resume UI).

---

## E. Reports

### P13-D32 — A Z-report is an immutable snapshot written inside the close

`shift_report`, one row per shift (`unique(shift_id)`), written by `closeShift` in the **same**
transaction that writes the close. It stores the frozen figures: sale count, void count, refund
count, gross, refunds, net, discounts, loyalty points, the four tax components, one column per
tender method, change, cash in/out, expected, counted, variance and item count.

There is no update and no delete path. A correction after the fact is a new document, not an edit.

Exercised in: Plan 02 (table), Plan 07 (write), Plan 12 (print).

### P13-D33 — An X-report is computed and never stored

`GET /api/pos/shifts/:id/report?kind=X` (device auth, own shift only) composes
`selectShiftCashTotals` plus a tender breakdown and today's sale aggregates. It writes nothing, so
it can be run as often as a manager likes. The till's X-report is computed from its **local** rows;
it must agree with the server's figure for a closed shift, and Plan 13 asserts that agreement.

Exercised in: Plan 07 (endpoint), Plan 12 (screen).

### P13-D34 — The Z-report is a printable document built from the snapshot

A new ESC/POS builder (`buildReportBytes`) alongside `buildReceiptBytes`: header, shift number,
terminal, cashier, open/close times, tender breakdown, tax breakdown, refunds and voids, expected /
counted / variance in words, and a signature line. It is built from the **local** snapshot so it
prints offline, and a reprint is marked as one.

Exercised in: Plan 12.

### P13-D35 — Recall re-prices; it does not silently re-quote

Context D17 says recall "re-prices every line … recomputes discounts and loyalty". Recomputing a
loyalty redemption against a balance that has moved since 10am is not a re-price, it is a new
promise. The rule:

- prices are re-read from `product_price`/`product` and the line is re-priced;
- a line whose product is archived or missing is flagged and must be removed or replaced;
- line and sale discounts are preserved as **amounts**, then clamped to the new line gross through
  `priceCart` (which already clamps rather than throws);
- a loyalty redemption is **preserved as points** if the account still holds them, and reduced to
  the affordable maximum with an explicit notice if it does not;
- every difference is listed by product with old and new, and the cart cannot complete until the
  cashier acknowledges the list.

Exercised in: Plan 01 (`repriceHold` pure function + tests), Plan 12 (notice UI).

---

## F. Permissions, settings, migrations, security

### P13-D36 — One new permission, and the till still holds none

`PERMISSIONS` gains **`pos.refund`**, granted to ADMIN and MANAGER. It is used in two places: the
till's `approveOverride` (so only a manager or admin can authorise a refund) and the server's
`validateOverrideProof(..., 'pos.refund')`. `OverridePermission` extends to
`'credit.override' | 'pos.discount' | 'pos.refund'`.

`CASHIER_PERMISSIONS` stays `[]`. A cashier reaches the POS through a device-bound PIN, never through
the admin API, and giving them a permission string would be a fiction that some future route would
check.

Exercised in: Plan 01, Plan 05, Plan 10.

### P13-D37 — Settings

| Key | Type | Default | Scope | Writable by |
|---|---|---|---|---|
| `pos.refundApprovalThresholdMinor` | int 0…1 000 000 | `20_000` | branch | admin |

`pos.refundApprovalThresholdMinor` is branch-overridable and admin-writable for the same reason
`pos.shiftVarianceToleranceMinor` is: a branch that can set its own refund cap has none.

There is deliberately **no** refund numbering setting. The till allocates
`RF-<terminalCode>-<day>-NNNN` from its local `document_sequence` in the same transaction that writes
the refund, so a refund can be numbered with the cable unplugged; the server stores the number and
enforces `unique(refund.number)`. A server-side sequence would be a key nothing writes.

Exercised in: Plan 02.

### P13-D38 — Enums get their own migration file, then the DDL

`NNNN_enum_phase13.sql` carries only `ALTER TYPE … ADD VALUE IF NOT EXISTS` for:

- `sale_tender_method`: `MOMO`, `CARD`, `BANK_TRANSFER`
- `pos_transaction_type`: `REFUND`, `CREDIT_REPAYMENT`, `CART_VOID`
- `stock_movement_type`: `RETURN`
- `stock_movement_reference`: `REFUND`
- `sync_conflict_type`: `PAYMENT_LATE_SETTLEMENT`, `PAYMENT_AMOUNT_MISMATCH`

`NNNN_phase13_payments.sql` carries the tables, columns, indexes, and the new enums
(`payment_method`, `payment_provider`, `payment_status`, `refund_reason`, `refund_restock`,
`refund_tender_status`, `cart_void_reason`) — creating an enum and using it in the same file is
safe; only **adding a value to an existing** enum is not.

The migration is generated then split by hand, and `drizzle-kit generate` is not re-run afterwards.

Exercised in: Plan 02.

### P13-D39 — OWASP acceptance criteria for this phase

| OWASP 2025 | This phase |
|---|---|
| A01 Broken access control | Every device route resolves branch/terminal/shift from the token, never the body; `payment` and `refund` reads are scoped to the device's own terminal; a sale tender may only reference a payment from the same terminal (P13-D6). The webhook has no session by design and is the only such route. |
| A02 Misconfiguration | `PAYSTACK_MODE=mock` refuses to boot without a key; no card channel is ever opened in our renderer; CORS unchanged; the checkout window has no preload. |
| A03 Supply chain | No new runtime dependency for HMAC (`node:crypto`) or HTTP (`fetch`). |
| A04 Cryptographic failures | HMAC-SHA512, `timingSafeEqual`, raw-body comparison; Argon2id for the PIN proof (unchanged); TLS only, `https` base URL enforced. |
| A05 Injection | Zod on every body and query; Drizzle parameters only; the webhook body is never interpolated into SQL, and `event_type` is allowlisted, not free text. |
| A06 Insecure design | Money never leaves on a client assertion; refunds capped per tender under a row lock; an orphan payment is a conflict, not an automatic refund. |
| A07 Auth failures | Device JWT + per-device rate limits on every new endpoint; the webhook is signature-only and its failures are 401, not 500. |
| A08 Integrity failures | Idempotency by `(terminal_id, client_transaction_id)`, by `(terminal_id, client_payment_id)`, by `provider_reference`, and by webhook body hash. |
| A09 Logging failures | No secret, token, card field or full webhook body in logs; audit rows for refund, repayment and void. |
| A10 Exceptional conditions | A provider timeout is `PENDING`, not `FAILED`; a refund whose provider call fails stays `PENDING` and visible; a rejected upload is stored as `REJECTED` and still returns 200. |

Exercised in: Plan 13 (the table is reproduced with legs).

### P13-D40 — Verification is goal-backward, and the ledgers are the goal

Proofs this phase owes, each named in a plan:

- `Σ sale_tender.amount − sale.change_minor = sale.total_minor` for every sale, including splits;
- a refund never moves `sale.total_minor` or `sale.tender_total_minor`, and
  `Σ refund_tender ≤ Σ sale_tender − change` for the sale;
- the credit ledger receives exactly the credit portion of a split, and exactly `−amount` for a
  repayment;
- `shift_report` equals a recomputation from `sale`, `sale_tender`, `refund`, `cart_void` and
  `cash_movement` for the shift;
- `payment.PAID` count × amount equals the sum of electronic `sale_tender` rows plus orphaned
  payments;
- a webhook replay changes nothing and returns 200;
- the till completes a full offline cash sale and a full offline cash refund, and neither waits on
  the network.

Exercised in: Plan 13.

### P13-D41 — The shift close learns who closed it, which retires Phase 12's carry-forward

Phase 12 recorded a real limit (`12-VERIFICATION.md` §6): the `SHIFT_CLOSE` payload carries no staff
identity, so `closeShift` has to make the shift's **cashier** the requester of a variance review — and
a manager signing off a cashier's drawer could therefore review their own act if they were also the
cashier on that shift.

This phase is already changing the close path (holds, the Z snapshot), so the payload gains
`closedBy: { userId, staffId, bindingId, bindingToken, pinVersion }`, validated exactly like a sale's
`cashier`. The server resolves it, requires it to be an active binding **on that device**, and uses it
as the approval's requester. A manager who closes another cashier's drawer is now named as the
requester, and the no-self-approval rule finally bites in the case Phase 12 could only describe.

The field is additive: an old till that omits it falls back to the shift's cashier, which is today's
behaviour, so the change is deployed before it is relied on.

Exercised in: Plan 06 (wire), Plan 11 (the till sends it), Plan 13 (a leg proving the manager cannot
review their own close).
