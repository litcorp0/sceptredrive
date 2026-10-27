---
phase: 13-pos-payments-returns
plan: 01
title: Shared vocabulary — tender, refund and hold arithmetic, reasons, permission
lane: shared
depends_on: []
requirements: [POS-10, POS-11, POS-12, POS-15, POS-16]
---

# Plan 01 — One arithmetic for tenders, refunds and holds

## Goal

Every rule this phase enforces twice — once at the till and once on the server — exists exactly once,
in `packages/shared`, with tests that state the boundary. Nothing here talks to a database, a
network, or a React tree.

## Read first

- `00-DECISIONS.md` P13-D3, D17, D19, D22, D28, D29, D35, D36.
- `packages/shared/src/pos.ts` — `priceCart`, `allocateProportionally`, `PricedCart`. This plan does
  **not** edit it.
- `packages/shared/src/pos.test.ts` and `money.test.ts` — the test idiom (plain `describe`, hand
  arithmetic in the assertion, no snapshots).
- `packages/shared/src/permissions.ts:3-80` — the list and the role matrix.
- `desktop/src/renderer/lib/sale/sale-draft.ts:16` — the duplicate `TenderMethod` this plan replaces.

## Tasks

### 1. `packages/shared/src/tender.ts`

```ts
export const TENDER_METHODS = ['CASH', 'CREDIT', 'MOMO', 'CARD', 'BANK_TRANSFER'] as const
export type TenderMethod = (typeof TENDER_METHODS)[number]

export const ELECTRONIC_TENDER_METHODS = ['MOMO', 'CARD', 'BANK_TRANSFER'] as const
export type ElectronicTenderMethod = (typeof ELECTRONIC_TENDER_METHODS)[number]

export function isTenderMethod(value: string): value is TenderMethod
export function isElectronicTender(method: TenderMethod): method is ElectronicTenderMethod

export const MAX_TENDERS_PER_SALE = 5

export interface TenderLine {
  method: TenderMethod
  amountMinor: number
  sequence: number
}

export type TenderProblem =
  | 'NEGATIVE_TENDER'
  | 'TOO_MANY_TENDERS'
  | 'MULTIPLE_CREDIT_TENDERS'
  | 'CREDIT_EXCEEDS_TOTAL'
  | 'OVERPAID_BY_ELECTRONIC'
  | 'UNPAID_BALANCE'

export interface TenderBalance {
  totalMinor: number
  appliedMinor: number
  cashMinor: number
  creditMinor: number
  electronicMinor: number
  remainingMinor: number
  changeMinor: number
  problem: TenderProblem | null
}

export function tenderBalance(totalMinor: number, tenders: readonly TenderLine[]): TenderBalance
export function changeFromCash(totalMinor: number, tenders: readonly TenderLine[]): number
export const TENDER_PROBLEM_MESSAGES: Record<TenderProblem, string>
export const TENDER_LABELS: Record<TenderMethod, string>  // Cash, Credit, MoMo, Card, Bank transfer
```

Rules (P13-D3), each with a test:

- `applied = Σ amountMinor`; `remaining = max(0, total − applied)`;
  `change = max(0, applied − total)`.
- `change <= cashMinor` always, because that is the only tender that can overpay. A tender set that
  violates it returns `change = 0` **and** `problem = 'OVERPAID_BY_ELECTRONIC'` — a caller must not
  be able to read a plausible number off an impossible tender set.
- Two credit tenders → `MULTIPLE_CREDIT_TENDERS`. Credit greater than the total →
  `CREDIT_EXCEEDS_TOTAL`.
- `total === 0` and no tenders is valid (`applied 0`, `change 0`, `problem null`).
- `total === 0` with tenders is `UNPAID_BALANCE` (nothing should be paid on a zero sale).
- `applied < total` → `UNPAID_BALANCE`; that is the only problem that is also a legitimate
  intermediate state while a cashier is still typing.
- More than `MAX_TENDERS_PER_SALE` → `TOO_MANY_TENDERS`.
- `sequence` is 1-based and unique; a duplicate is a caller bug, asserted with a `RangeError`, not a
  problem code, because no screen can produce it.

### 2. `packages/shared/src/refund.ts`

```ts
export const REFUND_REASONS = [
  'CUSTOMER_CHANGED_MIND', 'WRONG_ITEM', 'DEFECTIVE', 'PRICE_DISPUTE',
  'DUPLICATE_SALE', 'OTHER',
] as const
export type RefundReason = (typeof REFUND_REASONS)[number]
export const REFUND_REASON_LABELS: Record<RefundReason, string>

export const REFUND_RESTOCK_OPTIONS = ['RESALABLE', 'DAMAGED', 'NOT_RETURNED'] as const
export type RefundRestock = (typeof REFUND_RESTOCK_OPTIONS)[number]
export const REFUND_RESTOCK_LABELS: Record<RefundRestock, string>

/** `RESALABLE` is the only option that moves stock back in (P13-D22). */
export function movesStockBack(restock: RefundRestock): boolean
export function restockRequiresReason(restock: RefundRestock): boolean   // DAMAGED only

export interface RefundableSaleLine { saleLineId: string; quantity: number; refundedQuantity: number }
export function refundableQuantity(line: RefundableSaleLine): number

export interface RefundableTender { saleTenderId: string; amountMinor: number; refundedMinor: number }
export function refundableTenderMinor(tender: RefundableTender): number
export type RefundAllocationProblem = 'EXCEEDS_LINE' | 'EXCEEDS_TENDER' | 'SUM_MISMATCH' |
  'EXCEEDS_SALE' | 'NO_ALLOCATION'
export interface RefundAllocation {
  lines: Array<{ saleLineId: string; quantity: number }>
  tenders: Array<{ saleTenderId: string; amountMinor: number }>
}
export function refundAllocationProblem(input: {
  allocation: RefundAllocation
  lines: readonly RefundableSaleLine[]
  tenders: readonly RefundableTender[]
  refundedMinor: number
  saleTenderTotalMinor: number
  saleChangeMinor: number
}): RefundAllocationProblem | null

/** `>=` — a refund of exactly the cap needs an approval (P13-D21). */
export function refundApprovalRequired(refundedMinor: number, thresholdMinor: number): boolean
```

`refundAllocationProblem` checks, in this order: every line quantity ≤ `refundableQuantity`; every
tender amount ≤ `refundableTenderMinor`; `Σ tenders === refundedMinor`; and
`refundedMinor ≤ saleTenderTotalMinor − saleChangeMinor`. The last one is the invariant that makes
change unrefundable and is the reason the function takes the sale's change at all.

### 3. `packages/shared/src/cart-void.ts`

```ts
export const CART_VOID_REASONS = [
  'CUSTOMER_CHANGED_MIND', 'WRONG_ITEM', 'PRICE_DISPUTE',
  'DUPLICATE_SCAN', 'CUSTOMER_LEFT', 'OTHER',
] as const
export type CartVoidReason = (typeof CART_VOID_REASONS)[number]
export const CART_VOID_REASON_LABELS: Record<CartVoidReason, string>
export function cartVoidNeedsNote(reason: CartVoidReason): boolean    // OTHER only
export function cartVoidNoteProblem(reason: CartVoidReason, note: string | null): string | null
```

`cartVoidNoteProblem` returns `null` when the pairing is valid, otherwise a sentence a cashier can
read ("Say why in a few words — at least 3 characters").

### 4. `packages/shared/src/hold.ts`

```ts
export const MAX_HELD_CARTS = 10
export const HOLD_LABEL_MAX = 60

export function holdLabelProblem(label: string, existingCount: number): string | null
// empty/blank → "Give the cart a name so you can find it"; > 60 → length message;
// existingCount >= 10 → "Ten carts are already held on this till. Use one or void one."

export interface HoldLine {
  productId: string; sku: string; name: string; quantity: number
  unitPriceMinor: number; taxCategory: TaxCategory
  lineDiscountMinor: number; lineDiscountReason: string | null; lineDiscountNote: string | null
}
export interface CatalogueSnapshotLine {
  productId: string; name: string; sku: string
  unitPriceMinor: number; taxCategory: TaxCategory; isActive: boolean
}
export type HoldDifferenceKind = 'PRICE' | 'ARCHIVED' | 'GONE'
export interface HoldDifference {
  productId: string; name: string; kind: HoldDifferenceKind
  fromMinor: number; toMinor: number
}
export interface RepricedHold {
  lines: HoldLine[]              // priced at today's catalogue, discounts clamped
  differences: HoldDifference[]
  loyaltyPointsRequested: number
  requiresAcknowledgement: boolean
}
export function repriceHeldCart(input: {
  lines: readonly HoldLine[]
  catalogue: readonly CatalogueSnapshotLine[]
  loyaltyPointsRequested: number
  pricing: CartPricingOptions
}): RepricedHold
```

`repriceHeldCart` re-prices through `priceCart` (never re-implements a discount rule), turns a
missing product into a `GONE` line kept at its old price so the cashier can see what it was, clamps
each line discount to the new line gross, and sets `requiresAcknowledgement` when any difference
exists. It does **not** decide the loyalty question — it returns the requested points and lets the
caller apply `maxRedeemablePoints` with the live balance (P13-D35).

### 5. Permission and its label

`permissions.ts`: add `'pos.refund'` immediately after `'pos.discount'` in `PERMISSIONS`, and add it
to `ADMIN_PERMISSIONS` and `MANAGER_PERMISSIONS`. `CASHIER_PERMISSIONS` stays `[]`. Update
`permissions.test.ts`'s counts (ADMIN 65→66, MANAGER 48→49) and add a case asserting a cashier still
holds nothing.

### 6. `packages/shared/src/index.ts`

Add `export * from './refund.ts'`, `'./tender.ts'`, `'./cart-void.ts'`, `'./hold.ts'` in alphabetical
position.

### 7. Documentation correction (controller-owned, already applied)

`REQUIREMENTS.md` POS-15 now reads "…recall any cart held on that terminal — after a restart or after
a shift change, by any cashier who signs in there. Holds are terminal-local and are not synced
(operator decision 2026-10-27, P13-D29)". That wording was applied during planning on 2026-10-27; the
executor verifies it and changes nothing else in the file. `AGENTS.md` is untouched.

## Tests

One `describe` per module, hand-computed fixtures:

- **tender**: 100.00 total, 50.00 cash + 50.00 MoMo → applied 100.00, change 0, no problem;
  50.00 cash + 60.00 MoMo → `OVERPAID_BY_ELECTRONIC` and change **0**; 40.00 cash + 40.00 credit +
  20.00 card on 100.00 → `UNPAID_BALANCE` with `remainingMinor = 0`; 30.00 cash + 70.00 credit on
  100.00 paid with 100.00 cash → change 0 (credit never produces change); 20.00 cash + 80.00 credit
  with 10.00 cash over → change 10.00; two credit tenders → `MULTIPLE_CREDIT_TENDERS`; six tenders →
  `TOO_MANY_TENDERS`; zero sale with no tenders → valid.
- **refund**: `refundableQuantity` at 0 and at the cap; a line one over the cap → `EXCEEDS_LINE`;
  tender over its remainder → `EXCEEDS_TENDER`; allocations that do not sum → `SUM_MISMATCH`;
  100.00 tender total with 10.00 change, refund of 91.00 → `EXCEEDS_SALE`; 90.00 → null;
  `refundApprovalRequired(20_000, 20_000)` → **true**, `(19_999, 20_000)` → false.
- **hold**: blank, 61 characters, 10 existing; `repriceHeldCart` with a price that rose 10.00, a
  product archived, a product deleted, and a line discount now larger than the line gross (asserted
  clamped, and that the clamp came from `priceCart`).
- **cart void**: `OTHER` with no note and with a two-character note both refused; every other reason
  needs none.

## Verification

```bash
bun run --filter @sceptre/shared test
bun run check-types
bun run --filter shared lint
```

Expected: shared **239 → ~285**. API, desktop and admin untouched.

## Commits

1. `feat(shared): tender arithmetic with cash-only change`
2. `feat(shared): refund caps per line and per tender`
3. `feat(shared): cart-void reasons and held-cart re-pricing`
4. `feat(shared): pos.refund joins the permission vocabulary`

(The POS-15 wording correction is already committed with the phase's planning set.)

## Done when

- A split tender can be judged valid or impossible by one function, on both sides of the wire.
- A refund that would exceed a line, a tender, the sale, or the change is refused by arithmetic
  before it reaches a database.
- Recall returns the lines to price plus a list of what changed, and never throws because a product
  vanished.
