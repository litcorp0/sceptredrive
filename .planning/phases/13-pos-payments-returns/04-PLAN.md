---
phase: 13-pos-payments-returns
plan: 04
title: Sale completion — multi-tender, credit split, payment linkage
lane: api
depends_on: [03]
requirements: [POS-11, POS-13, PAY-01, PAY-02]
---

# Plan 04 — A sale that took three tenders is still one sale

## Goal

`POST /api/pos/sync/upload` accepts a `SALE` whose tenders are cash, credit and up to three
electronic payments, in any order, and applies it exactly as the till wrote it — or rejects it
whole. The sale's money identity holds for every combination, and an electronic tender is only
accepted when the server itself settled that payment.

## Read first

- `00-DECISIONS.md` P13-D1, D2, D3, D4, D5, D6, D15.
- `api/src/modules/pos/pos.service.ts:803-1162` — `assertSaleShape`, steps 1–8, and the block that
  throws `Split tender is not supported in this phase`.
- `api/src/modules/pos/pos.service.ts:1289-1365` — the row writes, including `reference: null`.
- `api/src/modules/sync/sync.validation.ts:83-145` — `salePayloadSchema`, whose `.max(2)` becomes
  `.max(5)`.
- `api/src/modules/payments/payments.service.ts` (Plan 03) — the `PAID` predicate and the projection.
- `packages/shared/src/tender.ts` (Plan 01) — `tenderBalance`.
- `api/src/modules/credit/credit.service.ts:235-379` — `postEntryInTransaction`, unchanged by this
  plan except for the amount it receives.

## Tasks

### 1. Wire contract

`sync.validation.ts`:

```ts
const tenderSchema = z.object({
  method: z.enum(TENDER_METHODS),
  amountMinor: minorUnits,
  /** REQUIRED for MOMO | CARD | BANK_TRANSFER, forbidden otherwise. */
  paymentId: z.uuid().nullish(),
  override: overrideProofSchema.nullish(),
}).strict().superRefine((tender, ctx) => {
  const electronic = ELECTRONIC_TENDER_METHODS.includes(tender.method as ElectronicTenderMethod)
  if (electronic && !tender.paymentId)
    ctx.addIssue({ code: 'custom', message: 'An electronic tender needs its paid payment' })
  if (!electronic && tender.paymentId)
    ctx.addIssue({ code: 'custom', message: 'Cash and credit tenders carry no payment' })
})

tenders: z.array(tenderSchema).max(MAX_TENDERS_PER_SALE)
```

Array order **is** the tender order; the server writes `sequence = index + 1` and the payload does not
carry one. That removes a field that could disagree with the array.

`sync.types.ts` gains nothing (the payload type is inferred from Zod at the service boundary, as
today).

### 2. `applySale` — replace the single-tender block

Delete `if (payload.tenders.length > 1) throw saleRejected('INVALID_TENDER', …)` and the whole
single-tender branch. Replace with, in this order:

1. **Shape**: every `amountMinor` is a non-negative safe integer; the array is at most
   `MAX_TENDERS_PER_SALE`; a total > 0 sale has at least one tender; a zero-total sale has none.
2. **Arithmetic** via `tenderBalance(header.totalMinor, tenders)`; any non-null `problem` →
   `saleRejected('INVALID_TENDER', problem)`.
3. **Change**: `payload.totals.changeMinor` must equal the computed `changeMinor` exactly.
4. **Credit**: at most one `CREDIT` tender; its amount equals
   `payload.tenders.reduce(credit)`, which becomes `sale.credit_amount_minor`; a credit tender
   requires a customer (existing `NO_CUSTOMER_FOR_CREDIT` shape, now per-tender).
5. **Electronic**: for each electronic tender, `SELECT … FROM payment WHERE id = $paymentId FOR
   SHARE`, then reject unless all of:
   - the row exists;
   - `payment.terminal_id = context.device.terminalId` and `branch_id = context.device.branchId`;
   - `payment.shift_id = payload.shiftId`;
   - `payment.status = 'PAID'`;
   - `payment.amount_minor = tender.amountMinor`;
   - no other `sale_tender` references it (the partial unique is the backstop, the check is the
     error message).
6. **The credit charge** uses `creditAmountMinor` instead of the single tender's `amountMinor`; its
   `idempotencyKey` stays `<clientTransactionId>:credit`. The `credit.override` proof is validated
   once, against the credit portion.

All six run **before** any row is written, so a rejected sale leaves nothing behind.

### 3. Row writes

```ts
await insertSaleTenders(
  payload.tenders.map((tender, index) => ({
    saleId,
    sequence: index + 1,
    method: tender.method,
    amountMinor: tender.amountMinor,
    paymentId: tender.paymentId ?? null,
    reference: paymentReferenceById.get(tender.paymentId ?? '') ?? null,
  })),
  executor,
)
```

`reference` is the provider reference, looked up once for the whole sale in the same statement that
validates the payments (one query, `WHERE id = ANY($1)`), so it is never a second round trip and
never client-supplied.

`insertSale` gains `creditAmountMinor` from step 2.4 and keeps `tenderTotalMinor = Σ tenders` and
`changeMinor` from the payload once validated.

### 4. Conflict and audit behaviour is unchanged

`PRICE_MISMATCH`, `STOCK_OVERSELL`, `CREDIT_OVER_LIMIT`, `CREDIT_HOLD`, `TOTAL_MISMATCH`,
`LOYALTY_*`, `STALE_CREDENTIALS`, `CLOCK_SKEW`, `OVERRIDE_INVALID` all still record and apply. The
new tender rules are **integrity**, not business policy: an impossible tender set is a client defect
and the sale does not apply.

### 5. The partial unique index is the backstop, not the check

`sale_tender_payment_unique` (Plan 02) refuses the second reference at the database. The service
check in step 2.5 exists so the till gets `INVALID_TENDER` with a readable message instead of a
unique-violation 500 — not because the index is optional.

### 6. Tests (`pos.test.ts`, new `pos.tender.test.ts`)

Fixtures: branch, terminal, device, open shift, two active products, a customer with a limit. Each
test creates its own payment through the Plan 03 mock harness.

- cash only, 100.00 on a 90.00 sale → `change = 10.00`, one tender, `credit = 0`;
- cash 40 + MoMo 60 on 100 → two tenders, sequences 1 and 2, `reference` = the payment's provider
  reference, `credit_amount_minor = 0`;
- cash 30 + credit 30 + card 40 on 100 → three tenders; the credit ledger holds exactly **30.00**;
  `credit_amount_minor = 30`;
- MoMo 25 + MoMo 25 + cash 50 on 100 → two tenders of one method, both stored;
- `Σ tenders − change ≠ total` → `INVALID_TENDER`, **zero** rows written (assert every table count);
- cash 100 with `change = 0` declared → rejected;
- change 20 on a sale whose cash portion is 10 → `OVERPAID_BY_ELECTRONIC`;
- credit 60 on a 50 sale → `CREDIT_EXCEEDS_TOTAL`;
- two credit tenders → `MULTIPLE_CREDIT_TENDERS`;
- six tenders → validation 400 before the service;
- a `paymentId` that is `PENDING` → `INVALID_TENDER`, sale not written;
- a `paymentId` belonging to another terminal → `INVALID_TENDER`;
- the same `paymentId` twice in one sale → `INVALID_TENDER` (and the partial unique would also
  refuse);
- the same `paymentId` in a **second** sale → `INVALID_TENDER`;
- zero-total sale with a tender → `INVALID_TENDER`; with none → applies;
- over-limit split credit still **applies** and records `CREDIT_OVER_LIMIT` (the money was taken);
- the existing Phase 6 single-tender tests are unchanged and green.

### 7. One test that proves the identity rather than the shape

After the three-tender sale:

```sql
SELECT SUM(st.amount_minor) - s.change_minor - s.total_minor AS drift, COUNT(*) AS tenders
FROM sale_tender st JOIN sale s ON s.id = st.sale_id
WHERE s.id = $1 GROUP BY s.total_minor, s.change_minor
```

`drift = 0`, `tenders = 3`. And `SELECT SUM(amount_minor) FROM credit_ledger_entry WHERE
reference_id = $1 AND kind = 'CHARGE'` equals the credit tender.

## Verification

```bash
bun run --filter api test
bun run check-types
```

Expected: API **~625 → ~655**. Desktop still at **427**; the till cannot produce a split until Plan
08, and the single-tender path it does produce still validates.

## Commits

1. `feat(api): the sale wire accepts up to five ordered tenders`
2. `feat(api): an electronic tender is only money when the server settled its payment`
3. `feat(api): the credit portion of a split is what reaches the ledger`
4. `test(api): split-tender identities, refused payment reuse and the unchanged single path`

## Done when

- A three-tender sale applies, and the ledger holds exactly the credit portion.
- Every impossible tender set is refused before a single row is written, with a code that names the
  problem.
- No payment can settle two tenders, and no tender can cite a payment another terminal created.
