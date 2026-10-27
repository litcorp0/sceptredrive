---
phase: 13-pos-payments-returns
plan: 11
title: Held carts, cart void, shift close and the Z-report
lane: desktop
depends_on: [10]
requirements: [POS-13, POS-15, POS-16]
---

# Plan 11 — Park a basket, abandon one, and close the drawer with a number

## Goal

A cashier can hold up to ten labelled baskets, serve the queue, and recall any of them — after a
restart or after a shift change — with a visible list of what has changed since. Abandoning a cart is
a reason-coded record instead of a silent clear. Closing a shift asks what to do with the holds, writes
the Z-report, and prints it.

## Read first

- `00-DECISIONS.md` P13-D29, P13-D30, P13-D32 … P13-D35.
- `01-RESEARCH.md` §3 item 9 and §4 items 31–34.
- `desktop/src/renderer/lib/shift/shift-service.ts:240-294` — `closeShift`.
- `desktop/src/renderer/lib/shift/shift-repository.ts:235-296` — totals, close update, outbox.
- `desktop/src/renderer/lib/cart/cart-repository.ts:201-302` — `loadCartDraft`, `writeDraft`,
  `saveCartDraft`; the hold must **not** go through these.
- `desktop/src/renderer/lib/cart/cart-store.tsx:93-129` — draft load/save and the 150 ms debounce.
- `desktop/src/renderer/modules/sell/components/clear-cart-dialog.tsx` — the dialog this plan replaces.
- `desktop/src/renderer/modules/shift/pages/shift-page.tsx:166-216,266-...` — the close summary and
  dialogs.
- `desktop/src/main/printing/escpos.ts:32-75` — `buildReceiptBytes` / `buildDrawerBytes`.
- `packages/shared/src/hold.ts`, `cart-void.ts` (Plan 01).

## Tasks

### 1. `lib/hold/hold-service.ts`

```ts
export interface HoldableCart { lines; customer; loyaltyRedeemPoints; saleDiscount; totals }
export async function holdCart(db, input: { label: string; cart: HoldableCart }): Promise<{ holdId }>
export async function listHeldCarts(db): Promise<HeldCartSummary[]>
export async function recallHeldCart(db, holdId: string, shiftId: string): Promise<RecallResult>
export async function voidHeldCart(db, holdId: string, reason: CartVoidReason, note: string | null): Promise<void>
export async function countHeldCarts(db): Promise<number>
```

- `holdCart`: `holdLabelProblem(label, existingCount)` first; refuses an empty cart (there is nothing
  to hold). One transaction: insert `held_cart` + `held_cart_line`, then `dispatch({ type: 'clear' })`
  is **not** used — the caller clears after the hold is written, and the draft is deleted by the normal
  `writeDraft` path on the next mutation. A test asserts that a failed hold leaves the cart intact.
- `recallHeldCart`: reads the hold and lines, loads today's catalogue snapshot in one query, calls
  `repriceHeldCart`, **deletes the hold in the same transaction that writes the recalled draft**, and
  returns `{ cart, differences, requiresAcknowledgement }`. If the active draft already has lines, the
  active draft is **held** first under an automatic label (`"Cart #N"`, where N is the next free
  number) and the recall is refused if that is impossible (ten holds) — a recall must never destroy an
  active basket.
- `voidHeldCart`: the same `cart_void` path as §2, with `label` set and the reason the cashier chose.

### 2. Cart void replaces the silent clear

`lib/cart/void-service.ts`:

```ts
export async function recordCartVoid(db, input: {
  cart: CartState; priced: PricedCart; reasonCode: CartVoidReason; note: string | null
  label?: string | null
}): Promise<{ voidId }>
```

One transaction: insert `cart_void` (`item_count`, `gross_minor = priced.totalMinor`, `lines` as a
jsonb-style JSON string with productId/name/quantity/unitPriceMinor) and the `CART_VOID` outbox row,
then `notifyOutboxChanged()` after.

`clear-cart-dialog.tsx` becomes `void-cart-dialog.tsx`: a reason select (shared labels), a note field
that becomes required for `OTHER`, a summary ("6 items, GH₵142.00 — nothing has been charged"), and
**Continue** / **Keep cart**. The keyboard `Esc` keeps the cart. The old confirm button
(`data-testid="confirm-clear"`) is renamed `void-cart-confirm`, and the counter audit is updated in the
same commit with a note saying why.

Anywhere the old `clear()` was called from a control that discards a non-empty cart, it now opens this
dialog. `emptyCart()` remains for the post-sale reset.

### 3. The holds tray

`modules/sell/components/holds-tray.tsx`, always visible above the product grid when
`countHeldCarts() > 0`:

- one chip per hold: label, item count, total, held time (`formatTime`), held-by initials;
- **Recall** (click or `F7` cycling), **Void** (opens the void dialog with the hold's label);
- the tray is keyboard-navigable, `role="list"`, and each chip has an accessible name including the
  total;
- a **Hold cart** action in the sell header (`F8`), disabled on an empty cart, opening a small label
  dialog with the shared length rule and a live count "3 of 10 held".

### 4. Recall's differences panel

When `requiresAcknowledgement`, the cart is loaded and a dismissible panel lists every difference:

```
Brake pad set   GH₵120.00 → GH₵132.00   +GH₵12.00
Oil filter      Archived — remove or replace this line
Wiper blade     No longer in the catalogue — remove this line
```

`Complete` is disabled until **Acknowledge** is pressed, and a line whose product is `GONE` or
`ARCHIVED` must be removed before completion (`SaleCompletionCode.INVALID_CART` gains the case). A
loyalty redemption that had to shrink says so in the same panel ("1 200 points → 800, the balance is
800").

### 5. Shift close, holds and the Z-report

`closeShift` first sends `closedBy: { userId, staffId, bindingId, bindingToken, pinVersion }` from the
signed-in binding (P13-D41), so the variance review names the person who actually closed the drawer
rather than whoever opened it. Then:

1. If `countHeldCarts() > 0`, show a **holds step** before the count step: the list, and a required
   choice — **Keep for the next shift** or **Void all** (one `CART_VOID` per hold with
   `CUSTOMER_LEFT` and the note `"Voided at shift close: <label>"`). The close button is disabled until
   one is chosen. Closing is never blocked by a hold, only by not choosing.
2. After the counted amount is confirmed, compute the local Z figures with the same shape as the
   server's (`selectShiftCashTotals` + tender breakdown + refunds + voids + tax split + sale count),
   write the `shift_report` row and the `SHIFT_CLOSE` outbox row in **one** transaction, and print the
   report.
3. The close summary card (`data-testid="close-summary"`) gains the tender breakdown and the refund
   total, and keeps `varianceWords` as the only way variance is described.

### 6. X-report

`modules/shift/pages/report-page.tsx` (`#/shift/report`), reachable from the shift screen while open:
the same component as the Z screen with `kind = 'X'`, computed live, with a "not stored, not a close"
line. **Print X** is available; it prints the same document with `X-REPORT` and `generated at`.

### 7. Printing

`src/main/printing/escpos.ts` gains `buildReportBytes(report: ReportDocument, options)`, and
`src/main/ipc/printer.ts` gains `printReport` with a zod schema for the report document (lines are
`{ kind: 'title'|'row'|'rule'|'total'; label?: string; value?: string; emphasis?: boolean }[]`, so the
main process never learns business terms). The renderer builds the lines in
`lib/receipt/report-render.ts`, a pure function with tests: 42 columns, money formatted with
`formatMinorPlain`, no floats.

A Z-report print failure does not fail the close — the shift is closed on disk first, and the screen
offers **Print again**.

### 8. Tests (`desktop`)

- `hold-service.test.ts`: blank label refused; 11th hold refused; hold then recall returns the same
  lines re-priced; recall deletes the hold (a second recall is `NOT_FOUND`); recall with a non-empty
  active draft auto-holds it; a failed recall leaves both the hold and the draft intact; holds survive
  a `loadCartDraft` for a different shift.
- `void-service.test.ts`: `OTHER` without a note refused; the row carries item count and gross; the
  outbox row is `CART_VOID`; voiding a hold sets the label.
- `shift-service.test.ts`: closing with holds requires a choice; **Keep** leaves `countHeldCarts()`
  unchanged; **Void all** writes one `CART_VOID` per hold with `CUSTOMER_LEFT`; the `shift_report` row
  equals the local recomputation; the close still writes one `SHIFT_CLOSE` outbox row.
- `report-render.test.ts`: the Z document contains the tender breakdown, the tax split, the variance in
  words, and the reprint marker; the X document says "not stored".
- `cart-store.test.ts`: the 150 ms draft debounce is unchanged.

## Verification

```bash
bun run --filter desktop test
bun run --filter desktop check-types
bun run test:counter
bun run test:print
bun run lint
```

Expected: desktop **~520 → ~560**; packaged print smoke **21/21** still green (it drives the fake
ESC/POS adapter, which gains the report path).

## Commits

1. `feat(desktop): hold up to ten labelled carts on the terminal`
2. `feat(desktop): recall re-prices and lists every change`
3. `feat(desktop): abandoning a cart is a reason-coded void, not a silent clear`
4. `feat(desktop): shift close asks about holds and writes the Z-report`
5. `feat(desktop): X and Z reports print from the same document builder`
6. `test(desktop): hold lifecycle, void reasons and the report arithmetic`

## Done when

- A queue of ten customers can be parked and served in any order, across a restart and a shift change.
- Nothing a cashier does silently discards a basket with goods in it.
- A closed shift has a printed report whose figures equal the local rows, and the drawer figure is
  arithmetic rather than a typed number.
