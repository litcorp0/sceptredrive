---
phase: 13-pos-payments-returns
plan: 06
title: Credit repayment and cart void — two new device-originated facts
lane: api
depends_on: [05]
requirements: [POS-12, POS-16, PAY-01, APR-02]
---

# Plan 06 — A debt goes down and a basket goes away, both on the record

## Goal

A cashier can take a repayment against a customer's credit — in cash with the network unplugged, or
by MoMo when it is up — and can abandon an unfinished cart with a reason that reaches the server. Both
are ordinary uploaded facts: idempotent, audited, and never blocking the till.

## Read first

- `00-DECISIONS.md` P13-D27, P13-D28.
- `01-RESEARCH.md` §4 items 19–21, 28.
- `api/src/modules/credit/credit.service.ts:124-188,235-379` — `normalizeEntryInput`,
  `postEntryInTransaction`, and the `REPAYMENT` allocation at `:318-321`.
- `api/src/modules/credit/credit.types.ts:82-103` — `PostEntryInput`.
- `api/src/modules/pos/pos.service.ts:838-870` — the shape of a device-originated apply function.
- `api/src/modules/sync/sync.validation.ts:158-179` — the `CASH_MOVEMENT` schema this pair imitates.
- `packages/shared/src/cart-void.ts` (Plan 01).

## Tasks

### 1. Wire

`sync.types.ts`: `UploadTransactionType` gains `'CREDIT_REPAYMENT' | 'CART_VOID'`.
`pos_transaction_type` already has both (Plan 02).

`creditRepaymentPayloadSchema`:

```ts
{
  customerId: z.uuid(),
  shiftId: z.uuid(),
  cashier: { userId, staffId, bindingId, bindingToken, pinVersion },
  amountMinor: z.number().int().min(1).max(1_000_000_000),
  method: z.enum(['CASH', 'MOMO']),
  paymentId: z.uuid().nullish(),
  number: z.string().regex(/^[A-Za-z0-9-]+$/).max(64),   // the till's local receipt number
  note: z.string().trim().max(200).nullish(),
  override: overrideProofSchema.nullish(),
  occurredAt: z.iso.datetime(),
}
```

`MOMO` requires `paymentId`; `CASH` forbids it.

`cartVoidPayloadSchema`:

```ts
{
  shiftId: z.uuid(),
  cashier: { userId, staffId, bindingId, bindingToken, pinVersion },
  reasonCode: z.enum(CART_VOID_REASONS),
  note: z.string().trim().max(200).nullish(),
  itemCount: z.number().int().min(0).max(10_000),
  grossMinor: minorUnits,
  label: z.string().trim().max(60).nullish(),
  lines: z.array(z.object({ productId: z.uuid(), name: z.string().max(200),
    quantity: z.number().int().min(1).max(10_000), unitPriceMinor: minorUnits })).max(200),
  occurredAt: z.iso.datetime(),
}
```

Both `dispatchTransaction` arms call their service and return `{ serverId }`.

### 2. `applyRepayment` — `pos.service.ts`

```ts
export async function applyRepayment(
  context: SaleContext, payload: CreditRepaymentPayload, executor: DbExecutor = db,
): Promise<RepaymentApplyResult>
```

1. Lock the shift (`findShiftByIdForUpdate`), require it open and belonging to this device.
2. Lock the credit profile for the customer+branch (`postEntryInTransaction` does this itself, but the
   hold check must read it first so the refusal names the hold).
3. **Electronic**: `paymentId` must be `PAID`, same terminal/branch/shift, amount equal to the
   repayment, and not already referenced by another repayment. The reference is enforced by a partial
   unique on `credit_ledger_entry.reference_id` where `reference_type = 'POS_REPAYMENT'` — add it in
   this plan's migration slice.
4. **Hold**: if `profile.hold` and no `override`, reject `REPAYMENT_ON_HOLD`; with an override,
   `validateOverrideProof(executor, device, payload.override, 'credit.override')`.
5. `postEntryInTransaction(tx, actor, null, { customerId, branchId, kind: 'REPAYMENT',
   amountMinor: −payload.amountMinor, method: payload.method, note, referenceType: 'POS_REPAYMENT',
   referenceId: context.clientTransactionId, referenceNumber: payload.number, occurredAt,
   idempotencyKey: `${context.clientTransactionId}:repayment` })`.
6. Audit `pos.repayment.received` with the balance before and after.
7. Return `{ repaymentId, entryId, balanceAfterMinor }`.

### 3. One small change to `credit.service.ts`

`postEntryInTransaction` currently allocates a `referenceNumber` for every `REPAYMENT` from
`credit.repaymentSequence`. It must use an **explicit** `referenceNumber` when the caller provides
one (the till's offline number) and allocate only when it does not:

```ts
const referenceNumber = input.referenceNumber ??
  (input.kind === 'REPAYMENT' ? await allocateFromSequence('credit.repaymentSequence', tx) : null)
```

That is the only edit to this file, it is backward compatible (the console passes none), and it
keeps one receipt number in the customer's hand. A test asserts both branches.

### 4. `applyCartVoid` — `pos.service.ts`

1. Lock the shift as above.
2. `cartVoidNoteProblem(reasonCode, note)` → `CART_VOID_NOTE_REQUIRED` when it fails.
3. Insert `cart_void` with `id = context.clientTransactionId`. The primary key is the idempotency
   key: a replay is `onConflictDoNothing` and the stored result says `REPLAYED`.
4. Audit `pos.cart.voided` with the reason, item count and gross.
5. Return `{ cartVoidId }`.

No stock, credit or loyalty is touched: a voided cart never became a sale. The `grossMinor` is the
priced total at the moment of void, so the report has a value even though no money moved.

### 5. The shift close learns who closed it (P13-D41)

`SHIFT_CLOSE` gains an optional `closedBy: { userId, staffId, bindingId, bindingToken, pinVersion }`,
validated with the same schema as a sale's `cashier` and made `nullish` so a Phase 6 till still works.

`closeShift` resolves the binding when it is present (`requireActiveBinding`-equivalent inline: active,
unexpired, `pinVersion` matching, and the binding's device equal to the closing device) and uses it as
the approval's `actor`/requester for `SHIFT_VARIANCE_REVIEW`. When it is absent it falls back to
today's behaviour — the shift's cashier — and the approval's note says `closed_by: 'shift owner
(unattributed)'` so a reviewer can see the difference rather than guess.

Phase 12's self-review hole closes for every till running this phase's build; the fallback is what
keeps an un-updated terminal from breaking.

### 6. Migration slice

`credit_ledger_entry`:

```ts
uniqueIndex('credit_ledger_entry_pos_reference_unique')
  .on(table.referenceId)
  .where(sql`${table.referenceType} = 'POS_REPAYMENT'`)
```

### 7. Tests (`pos.repayment.test.ts`, `pos.cart-void.test.ts`)

Repayment:

- cash 50.00 against a 200.00 balance → one `REPAYMENT` entry, `amount_minor = −50 000`, balance
  150.00, `reference_number` equal to the payload's number;
- the console path (no `referenceNumber`) still allocates from the sequence — one test, unchanged
  behaviour;
- replay → `REPLAYED`, one entry;
- MoMo with a `PAID` payment of the same amount → applies, `method = 'MOMO'`;
- MoMo with a `PENDING` payment → `INVALID_TENDER`, nothing written;
- MoMo with a payment already used → refused;
- repayment on a held profile without an override → refused with a code naming the hold; with a
  manager override → applies;
- an override from a cashier binding → refused;
- amount 0 → validation 400 (the route, not the service).

Cart void:

- `OTHER` without a note → `CART_VOID_NOTE_REQUIRED`; `OTHER` with "price changed" → applies;
- every other reason with no note → applies;
- replay → one row, `REPLAYED`;
- 201 lines → validation 400;
- `grossMinor` 0 with one line → allowed (a zero-priced goodwill line is legal);
- a void from another terminal's device id — impossible by construction (the shift belongs to the
  device) — asserted as a 403 on the shift.

Shift close attribution (P13-D41):

- a `SHIFT_CLOSE` carrying `closedBy` for a manager who is **not** the shift's cashier, with a variance
  over tolerance → the approval's `requested_by` names the manager, and that manager's own decide
  attempt is a 403;
- the same close without `closedBy` → the requester is the shift's cashier, as Phase 12 behaved, and
  the approval note carries the unattributed marker;
- a `closedBy` binding from another device → 403, and the shift stays open.

### 8. Reconciliation

```sql
SELECT balance_minor FROM credit_profile WHERE customer_id = $c AND branch_id = $b
```

equals the last sale's opening balance minus every repayment plus every charge — computed
independently by summing `credit_ledger_entry` and compared in one assertion.

## Verification

```bash
bun run --filter api test
bun run check-types
```

Expected: API **~700 → ~725**. Desktop untouched until Plan 10 and Plan 11.

## Commits

1. `feat(api): the credit repayment wire and the paid-payment rule`
2. `feat(api): a repayment honours the till's own receipt number`
3. `feat(api): cart voids are reason-coded facts and never touch a ledger`
4. `test(api): repayment idempotency, the hold override and void reasons`

## Done when

- A cash repayment works with no network and prints one number, which the ledger keeps.
- A repayment cannot be paid twice by the same MoMo payment.
- A held account needs a manager to take money against it.
- A voided cart is recordable with a reason and changes nothing else.
