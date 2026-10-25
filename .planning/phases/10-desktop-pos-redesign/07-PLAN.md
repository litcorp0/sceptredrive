---
phase: 10-desktop-pos-redesign
plan: 07
title: Tender and receipt modules
lane: pos
depends_on: [03]
requirements: [UIX-09]
---

# Plan 07 — Tender and receipt

> **Ordering.** In the serial order this runs after Plan 06. It shares no file with it, so it may
> run beside it under README wave 4's directory split — Plan 06 owns
> `modules/{sell,cart,catalog,customers,credit,loyalty}`, this plan owns
> `modules/{tender,receipt}`.

## Goal

The two screens where money changes hands look like the rest of the product and stay exactly as
safe as they are. `complete-sale.ts`, the printing services, and the outbox are **not touched**:
the sale is still written in one local transaction with its outbox row, and a print failure
still never voids a sale.

## Read first

- `00-CONTEXT.md` D8, D10, D12.
- `modules/tender/pages/tender-page.tsx` and `components/tender-panel.tsx` — the cash keypad's
  pesewa-digit model. It is deliberately integer (typing `500` shows GHS 5.00); keep it.
- `lib/sale/complete-sale.ts` — read it, do not edit it.
- `lib/printing/print-sale.ts` and `lib/printing/printer-service.ts` — same.
- `desktop/test/e2e/print-smoke.mjs` (21 checks) — the test ids this screen must keep.
- `phases/06-pos-offline-core/evidence/printing.md` — why a failed print is not a failed sale.

## Tender

### 1. The money moment

The change figure is the largest number on the screen while cash is being counted, because it is
the only thing the cashier has to read aloud and hand over. Structure:

```
Total        GH₵ 245.00        (muted, tabular)
Received     GH₵ 300.00        (large, tabular, editable)
Change due   GH₵  55.00        (largest, font-display, tabular)
```

### 2. Short vs change without colour as the only signal

Today the pair is `text-amber-700` ("Short …") versus `text-emerald-700` ("Change …")
(`tender-panel.tsx:47-53`). The words already differ and the sign is already explicit, so colour
is redundant — and both classes are outside the token set.

After: the figure is `text-foreground`; a `--danger` dot and the word **Short** appear only in
the short case; **Change due** is the label otherwise. If a semantic colour is used at all it is
measured against `--card` for 4.5 : 1 with `scripts/check-tokens.mjs`'s formula and recorded —
Phase 7 measured `text-warn` on `bg-warn/10` at 4.39 : 1 and had to walk that back.

### 3. Targets

- Quick-note and keypad keys ≥ 44 × 44 (`Exact` is `h-10` today); the digit grid keeps a 4 × 3
  shape and the same `data-testid`s (`cash-keypad`, `exact-cash`, `tendered`, `change-due`).
- The `Complete sale` / `Pay` action stays 56 px and keeps `F9`.
- The method choice (Cash / Credit) becomes a `ToggleGroup`-style pair of 44 px buttons with a
  visible selected state that is not colour-only (a check icon or a border weight change).
- The credit state line keeps saying what the limit is and what is left, in the operator's
  words; an over-limit state names the manager approval it needs.

### 4. Notices and errors

Same rule as Plan 06: `bg-warn/10` / `bg-danger/10` with a dot, `text-foreground` label,
`role="alert"` for errors and `role="status"` for notices, Dismiss at 44 px.

`Escape` still returns to the sale without completing it, and the message that a declined credit
sale is recoverable ("Choose cash, or ask a manager") stays.

## Receipt

### 5. The receipt is a document, not a card of text

- `ReceiptView` keeps its byte-for-byte column layout (it mirrors the 42-column paper); it is
  presented on a `Card` with `font-mono` and a fixed measure so a 1024 px screen shows the same
  document the printer produced.
- The print state becomes a `Badge`: `PENDING`, `PRINTING`, `PRINTED`, `FAILED`. A `FAILED`
  receipt shows **Print again** as the primary action and a sentence that says the sale is
  saved — never that it failed.
- Reprint and Open drawer are 44 px `Button`s; a reprint increments and displays the count
  exactly as today.
- *Next sale* returns to `#home` (the landing changed in Plan 05), and *Today's sales* goes to
  `#pos/sales`.

### 6. Nothing about the money moves

Explicitly out of scope, and a diff touching any of them is a defect:

- `lib/sale/complete-sale.ts`, `lib/sale/sale-draft.ts`, `lib/sale/sale-repository.ts`
- `lib/printing/**`, `lib/outbox/**`
- the receipt number allocation in `lib/document-sequence.ts`
- every `data-testid` the print smoke and the offline walkthrough select

## Verification

```bash
bun run --filter desktop test
bun run --filter desktop check-types
bun run lint
bun run --filter desktop test:print        # 21 checks, needs the printer harness
grep -rn "amber-\|emerald-\|sky-\|red-\|zinc-" desktop/src/renderer/modules/tender \
  desktop/src/renderer/modules/receipt     # expect nothing
```

Manual at 1024 × 768: complete a cash sale, read the change at arm's length, print it, reprint
it, and open the drawer from the receipt screen. Then unplug the printer, complete a sale, and
confirm the screen says the sale is saved and offers *Print again*.

## Commits

1. `feat(desktop): the tender screen reads change at arm's length`
2. `refactor(desktop): tender controls at 44px on the primitives`
3. `refactor(desktop): the receipt as a document, with an honest print state`
4. `refactor(desktop): semantic colour tokens replace the raw palette on tender and receipt`

## Done when

- Change and short are distinguishable without colour, and every figure is tabular.
- Every control is ≥ 44 × 44 px; the completion action is 56 px and still `F9`.
- The receipt shows the same 42-column document as the paper, and a print failure is presented
  as a printer problem, never a sale problem.
- Zero raw palette classes in the two modules; the desktop suite and the print smoke pass with
  no edited assertions.
