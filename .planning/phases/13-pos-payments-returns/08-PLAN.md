---
phase: 13-pos-payments-returns
plan: 08
title: The local model and the split-tender sale (desktop)
lane: desktop
depends_on: [04]
requirements: [POS-11, POS-15, POS-16]
---

# Plan 08 — One till can take two kinds of money for one basket

## Goal

The till's own database can hold a sale with several tenders in order, a pending tender across a
restart, a held cart, a void and a shift report. The tender screen builds a tender set instead of
choosing one, and completion writes it in one transaction. Cash and credit work offline exactly as
they do today; the electronic methods arrive in Plan 09 and the builder is the only thing that has to
change for them.

## Read first

- `00-DECISIONS.md` P13-D1, D3, D5, D29, D31.
- `01-RESEARCH.md` §3 items 8–15 and §4 item 34.
- `desktop/src/renderer/lib/powersync/schema.ts:183-360,375-402` — `shift`, `sale`, `sale_tender`,
  `cart_draft`, `outbox`.
- `desktop/src/renderer/lib/powersync/schema-migration.ts:36-98,594` — the frozen `sale` and the
  proof that must still pass.
- `desktop/src/renderer/lib/sale/sale-draft.ts:16,121-132,183,197-252` — the tender and draft builder.
- `desktop/src/renderer/lib/sale/complete-sale.ts:119-176,253-259,383-423` — validation and the write.
- `desktop/src/renderer/lib/sale/sale-repository.ts:75,256,362` — `SaleTenderRow` and the `toTender`
  coercion to delete.
- `desktop/src/renderer/lib/receipt/render.ts:73-106,242-326` — the single-tender receipt.
- `desktop/src/renderer/modules/tender/pages/tender-page.tsx` and `components/tender-panel.tsx`.
- `packages/shared/src/tender.ts`, `hold.ts`, `cart-void.ts` (Plan 01).

## Tasks

### 1. The local schema (all of it, once)

`powersync/schema.ts`:

- `sale_tender` gains `sequence: minor`, `payment_id: column.text`, `provider_reference: column.text`,
  and an index `sale_tender_sale_sequence: ['sale_id','sequence']`. The existing
  `sale_tender_sale` index stays.
- `cart_tender` (new, local-only): `draft_id, sequence, method, amount_minor, momo_provider, phone,
  payment_id, provider_reference, status, display_text, expires_at, created_at`; index
  `cart_tender_draft: ['draft_id']`. Statuses are `PENDING|PAID|FAILED|EXPIRED`.
- `held_cart` and `held_cart_line` (new, local-only), columns exactly as P13-D29; indexes
  `held_cart_held_at: ['held_at']`, `held_cart_line_hold: ['hold_id']`.
- `cart_void` (new, local-only): `id, shift_id, reason_code, note, item_count, gross_minor, label,
  lines, occurred_at, created_at`; index `cart_void_created: ['created_at']`.
- `refund`, `refund_line`, `refund_tender` (new, local-only): the local mirror of the server
  documents, because the till has to know what is left refundable **offline** — `refund(id, number,
  sale_id, shift_id, reason_code, note, refunded_minor, base/vat/nhil/getfund/tax_total/total,
  approved_by_staff_id, approved_at, occurred_at, created_at)`, `refund_line(id, refund_id,
  sale_line_id, quantity, restock, damage_reason, total_minor)`, `refund_tender(id, refund_id,
  sequence, method, amount_minor, sale_tender_id, payment_id, status)`. Indexes
  `refund_sale: ['sale_id']`, `refund_line_refund: ['refund_id']`, `refund_line_sale_line:
  ['sale_line_id']`, `refund_tender_refund: ['refund_id']`.
- `shift_report` (new, local-only): every Z column from the server table, `shift_id` unique; index
  `shift_report_shift: ['shift_id']`.
- `PosSchema` includes all five; `SYNCED_TABLES` is **unchanged at eight**.

Re-run `desktop/src/renderer/lib/powersync/schema-migration.ts`'s proof and add the new tables to its
fixture where it enumerates `PosSchema.tables`. The frozen `previousSale` is not edited — the proof
exists to fail if someone edits `sale`'s shape, and this plan does not.

### 2. `TenderMethod` moves to shared

Delete the local union in `sale-draft.ts` and re-export from `@sceptre/shared`. Delete
`sale-repository.ts:256`'s `toTender` coercion (anything that is not `CREDIT` becomes `CASH`) and
replace it with a parser that reads the stored string through `isTenderMethod` and throws
`SaleDraftError('INVALID_TENDER')` on an unknown value. A silent coercion is how a stored `MOMO` row
would be read back as cash on the receipt.

### 3. The draft and the write

`sale-draft.ts`:

```ts
export interface SaleTenderDraft {
  method: TenderMethod
  amountMinor: number
  override: CartOverrideProof | null
  paymentId: string | null
  providerReference: string | null
}

export function buildSaleDraft(input: SaleDraftInput): SaleDraft   // tenders: SaleTenderDraft[]
```

- Validation now runs `tenderBalance(totalMinor, tenders)`; the first non-null problem becomes a
  `SaleDraftError` with that code.
- `changeMinor` comes from `changeFromCash`, never from a subtraction on one tender.
- `zeroTotal` still means no tenders and `changeMinor = 0`.
- A credit tender keeps its `override`; cash and electronic tenders must not carry one
  (`INVALID_TENDER`), except a credit tender that needs the limit override.

`complete-sale.ts`:

- `prepareSale` writes `sale_tender` rows with `sequence`, `payment_id`, `provider_reference`.
- The local `sale.credit_amount_minor` is the sum of the credit tenders.
- `CompleteSaleResult.tenderMethod` becomes `tenders: Array<{ method; amountMinor }>`; the receipt
  route already reloads the sale, so nothing else reads it.
- Stock, credit and loyalty deltas are unchanged except that the credit delta is the credit sum.

`writePreparedSale` gains `clearCartTenders(tx, draftId)` in the same transaction.

### 4. The tender screen

`tender-page.tsx` becomes a builder. State:

```ts
interface BuilderState {
  lines: Array<{ method: TenderMethod; amountMinor: number; inputMinor: number }>
  activeMethod: TenderMethod
  creditOverride: CartOverrideProof | null
  error: string | null
}
```

Behaviour, cash and credit only in this plan (`TENDER_METHODS.filter((m) => !isElectronicTender(m))`):

- **Add a tender** (Enter, or the method button) appends a line for the *remaining* balance, or for
  the typed amount when the cashier typed one.
- **Cash** may exceed the remainder; the excess is shown as change and the remaining balance goes to
  zero.
- **Credit** is offered only with a customer, fills the whole remainder, and is capped by headroom;
  the existing override dialog and the "continue without approval" path are unchanged.
- **Remove/backspace** on a line removes it and recomputes.
- **F9 / Complete** is enabled only when `tenderBalance(...).problem === null`; the keypad, the number
  row, the quick notes, the change readout and the shortfall readout keep their current
  `data-testid`s so the counter audit continues to drive them.
- A zero-total sale keeps the current `NoPaymentDue` panel.
- The credit panel keeps `creditLoading` (Phase 10's fix) and never invents an answer.

`tender-panel.tsx` gains `TenderList` (one row per tender: label, amount, remove) and
`TenderSummary` (applied, remaining, change), both driven by `tenderBalance`.

### 5. The receipt

`render.ts`: `ReceiptModel.tender` becomes `tenders: Array<{ method; amountMinor }>` plus
`tenderedMinor`, `changeMinor`. The payment block prints one line per tender in sequence order, then
`Tendered` and `Change` when there is more than one tender or any change. A single cash sale prints
exactly what it prints today (asserted in `render.test.ts` against the existing fixture, unchanged).

`modules/receipt/components/receipt-view.tsx` and `lib/printing/print-sale.ts` follow the type only.

### 6. The outbox union (mechanical, four files)

Add `'REFUND' | 'CREDIT_REPAYMENT' | 'CART_VOID'` to:

- `outbox/outbox-types.ts` `OUTBOX_TYPES`
- `api/types.ts:100`
- `shift/shift-repository.ts:270`

and update the server mirror is Plan 05/06's business. Also delete
`outbox-repository.ts:101`'s silent fallback: an unknown stored type must be a `dead_letter` with a
readable reason, not a `SALE`.

### 7. Tests (`desktop`)

- `sale-draft.test.ts`: the Phase 6 cases still pass (one cash, one credit, zero total, cash below
  total); new: cash 40 + credit 60 on 100 → two tenders, change 0, `credit_amount = 60`; cash 120 on
  100 → change 20; cash 50 + credit 60 on 100 → `CREDIT_EXCEEDS_TOTAL`? no — `OVERPAID_BY_ELECTRONIC`
  is for electronic; with a credit over the remainder the code is `CREDIT_EXCEEDS_TOTAL`; unknown
  stored method → `INVALID_TENDER`.
- `complete-sale.test.ts`: a two-tender sale writes two `sale_tender` rows with sequences 1 and 2,
  clears `cart_tender`, and leaves the outbox payload carrying both.
- `sale-repository.test.ts`: reading a `MOMO` row back returns `MOMO`.
- `schema-indexes.test.ts`: the new indexes exist.
- `schema-migration` E2E: run `bun run test:schema-migration` (it drives the proof through `#dev/sync`).

## Verification

```bash
bun run --filter desktop test
bun run --filter desktop check-types
bun run test:schema-migration
bun run lint
```

Expected: desktop **427 → ~455**. API and shared unchanged.

## Commits

1. `feat(desktop): the local schema for split tenders, holds, voids and shift reports`
2. `feat(desktop): the draft and the sale write carry an ordered tender set`
3. `feat(desktop): an unknown stored tender method is an error, not cash`
4. `feat(desktop): the tender screen builds a tender set`
5. `feat(desktop): the receipt prints each tender`
6. `test(desktop): split arithmetic, sequence order and the migration proof`

## Done when

- A cashier can take GH₵40 cash and GH₵60 on credit for one basket, offline, and the receipt shows
  both.
- Change is produced only by cash and is computed by the shared function.
- Every new local table is in the schema, indexed, and the migration proof still reasons about the
  frozen `sale`.
