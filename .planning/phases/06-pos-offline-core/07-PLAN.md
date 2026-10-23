---
phase: 06-pos-offline-core
plan: 07
wave: 5
title: Sale completion, receipts, ESC/POS printing, and cash drawer
requirements: [POS-06, POS-14]
depends_on: [02, 06]
status: complete
created: 2026-10-22
completed: 2026-10-23
---

# Plan 07 — Sale Completion, Receipts, Printing, Drawer

**Goal:** Completing a sale writes the sale, lines, tenders, pending deltas, and outbox row
in one local transaction, allocates the receipt number, clears the cart, prints an 80 mm
receipt through an ESC/POS adapter, kicks the cash drawer for cash tenders, and survives a
printer failure without losing or blocking the sale.

## Task 1 — Atomic local sale completion

**Files:** `desktop/src/renderer/lib/sale/complete-sale.ts`,
`desktop/src/renderer/lib/sale/sale-repository.ts`,
`desktop/src/renderer/lib/sale/document-sequence.ts`,
`desktop/src/renderer/routes/_pos/tender.tsx`,
`desktop/src/renderer/routes/_pos/receipt.$saleId.tsx`

- `completeSale(draft)`:
  1. require an open shift for the terminal and a logged-in staff binding; revalidate the
     cart with `priceCart` (quantity, discount, loyalty clamps);
  2. allocate `receiptNumber` from `document_sequence` scope `receipt`, day
     `Africa/Accra`, format `${terminal.code}-${YYYYMMDD}-${NNNN}` (pad 4, incrementing
     within the transaction);
  3. generate `saleId` and `clientTransactionId` as UUIDv7;
  4. in one `db.writeTransaction`:
     - insert `sale` with the priced header, `taxMode`, `occurredAt`, `shiftId`,
       `cashier*`, `customerId` (draft id allowed), `appVersion`,
       `printState = 'PENDING'`;
     - insert `sale_line`s with snapshots (sku/name/barcode) and the priced breakdown;
     - insert `sale_tender`s (cash and/or credit; a zero-total sale may have no tender);
     - insert negative `local_stock_delta` rows per product;
     - insert `local_credit_delta` for the credit amount and `local_loyalty_delta` for
       redeem (−) and earn preview (+) when a customer is attached;
     - insert an `outbox` row `{ type: 'SALE', payloadVersion: 1, payload }` with the
       exact draft (customer draft data, binding id/token, pin version, overrides,
       charged totals, preview totals) and `status = 'pending'`;
     - clear `cart_draft`/`cart_draft_line`;
  5. return the sale id. The UI navigates to the receipt screen; no network is awaited.
- Tender validation: `Σ tenders = total`; cash amount ≥ total; change =
  cash − total; credit amount = total (Phase 6 single tender); no tender when total = 0.
- The payload includes the **charged** per-line prices and total and the **preview**
  earn/redemption so the server can compare and flag drift.
- Crash safety: a failure before commit leaves the cart intact; after commit the sale is
  in the DB even if the renderer crashes before navigation. On app start, any sale with
  `printState = 'PENDING'` shows a reprint banner.

**Verify:** unit tests: receipt number sequence across days/restarts, tender arithmetic,
atomic rollback on an injected error, zero-total sale, duplicate product lines keep
separate sale lines while stock deltas aggregate; E2E complete a cash sale, restart,
sale + outbox exist exactly once.
**Commit:** `feat(pos): commit offline sales atomically`

## Task 2 — Receipt renderer

**Files:** `desktop/src/renderer/lib/receipt/render.ts`,
`desktop/src/renderer/lib/receipt/render.test.ts`,
`desktop/src/renderer/components/pos/receipt-view.tsx`,
`desktop/src/renderer/lib/format.ts`

- Pure `renderReceipt(sale, lines, tenders, { footer, branch, terminal, cashier,
  customer, reprint })` returns a structured receipt model:
  header (seller/branch/terminal, receipt number, date/time `Africa/Accra`, cashier),
  optional customer name/phone, lines (name, qty × price, discount, total), totals
  (subtotal, line discounts, sale discount, loyalty redemption, taxable base, VAT, NHIL,
  GETFund, total), tender (cash received/change or credit), points earned/redeemed,
  footer, reprint marker, and placeholder fields (`evatSerial`, `qrPayload`,
  `signature`) left empty for Phase 8.
- `toEscPosLines(model, columns = 42)` wraps text to 42 columns, formats money with the
  shared GHS formatter (no floats), right-aligns prices, and emits separators. Ghana cedi
  `GH₵` uses a fallback `GHS` if the printer charset cannot render it (configurable;
  default `GHS` for ESC/POS, `GH₵` on screen).
- `receipt-view.tsx` renders the same model on screen (A4/80 mm preview) for reprint and
  support; the on-screen and printed text come from one model.
- Tests: exact text for a seeded sale (golden file), 42-column wrapping with long names,
  zero-total sale, negative/oversold lines are not possible, reprint marker, tax
  components sum to total.

**Verify:** `bun run --filter desktop test`; golden receipt matches the seeded sale
numbers and totals; screen preview and ESC/POS text agree on every money field.
**Commit:** `feat(pos): render receipts from the local sale`

## Task 3 — Printer port and main-process ESC/POS adapter

**Files:** `desktop/src/main/ipc/printer.ts`,
`desktop/src/main/printing/escpos-printer.ts`,
`desktop/src/main/printing/fake-printer.ts`,
`desktop/src/main/printing/drawer.ts`,
`desktop/src/shared/ipc.ts`, `desktop/src/preload/preload.ts`,
`desktop/src/renderer/lib/printing/printer-service.ts`,
`desktop/package.json`

- Add `@maxxuxx/node-printer` **1.6.11** to `desktop` dependencies (native, auto-unpacked).
- `ReceiptPrinter` interface: `list()`, `print(model)`, `openDrawer()`, `test()`.
  - `escpos-printer.ts`: target from device settings (`winspool` + printer name, or
    `network` + host/port). Build bytes with `createReceipt({ columns: 42, encoding:
    'cp1252' })`; text rows, bold total, QR placeholder off, `feed(3)`, `cut()`. Call
    `print(target, bytes)`. Return `{ ok, errorCode? }`; never throw raw native errors to
    the renderer.
  - `drawer.ts`: raw ESC/POS kick `ESC p 0 25 250` (pin 2) appended and sent after the
    receipt; configurable pin (`2`/`5`) in device settings; a failed kick returns
    `DRAWER_FAILED` without failing the sale.
  - `fake-printer.ts`: writes `userData/receipts/<receipt>.txt` and `.escpos.bin`, and a
    `drawer.log` line; used when `POS_PRINTER_DRIVER=fake` or in tests.
- `list()` uses `getPrinters`/OS enumeration if available; otherwise returns the configured
  printer. `test()` prints a short pattern with the configured target.
- Preload exposes `printer.list/print/openDrawer/test`; inputs validated in main (target
  enum, receipt model shape, max sizes). The renderer never imports native modules.
- Device settings (local-only `device_setting` key/value): `printerDriver`
  (`winspool`/`network`/`fake`), `printerName`, `printerHost`, `printerPort`,
  `drawerPin`, `charset`, `copies`. Settings screen (manager/admin) edits them.

**Verify:** unit tests for the ESC/POS byte stream (starts with `ESC @`, contains the
receipt number, ends with cut), drawer bytes, target validation, and fake adapter file
output; on Linux dev, `fake` prints to files; `check-types`; a native smoke on Windows is
a human checklist item.
**Commit:** `feat(pos): add escpos printer port and drawer kick`

## Task 4 — Print orchestration and failure handling

**Files:** `desktop/src/renderer/lib/printing/print-sale.ts`,
`desktop/src/renderer/routes/_pos/receipt.$saleId.tsx`,
`desktop/src/renderer/components/pos/print-status.tsx`,
`desktop/src/renderer/routes/_pos/sales.tsx` (today's sales)

- After `completeSale` commits: set `printState = 'PRINTING'`; call
  `printer.print(model)`; on success set `'PRINTED'` + `printedAt`; on failure set
  `'FAILED'` + a short `printError`, keep the sale, show a non-blocking banner with
  "Retry print". For cash tenders, call `openDrawer` after a successful print (and also
  offer "Open drawer" if the print failed); never block navigation.
- Receipt screen: receipt preview, "Print again" (sets `reprint = true`, increments
  `reprintCount`, stores it), "New sale", and "Email/print" is out of scope. A reprint is
  visually marked `*** REPRINT ***`.
- Today's sales route (local): list of sales for the open/closed shift with receipt
  number, time, total, tender, print state; tap to open the receipt/reprint. This is the
  POS-side reprint path; Phase 8 adds the server-wide one.
- A sale completed while the printer is offline remains in the list with `PRINT_FAILED`
  and is retried after the printer is configured.

**Verify:** E2E with the fake adapter: complete a cash sale → receipt file contains the
sale, drawer log has the kick, state PRINTED; force the fake adapter to fail → sale is
committed, state FAILED, retry succeeds; reprint adds the marker and increments the
count; restart preserves today's sales.
**Commit:** `feat(pos): print receipts and handle failures without blocking sales`

## Task 5 — Hardware-neutral verification hooks

**Files:** `desktop/e2e/print.spec.ts`,
`desktop/src/main/printing/escpos-printer.test.ts`,
`.planning/phases/06-pos-offline-core/evidence/printing.md`

- E2E runs with `POS_PRINTER_DRIVER=fake`, `SHOTS_DIR`/`RECEIPTS_DIR` under `evidence/`.
- Assert the fake `.escpos.bin` contains the configured cut and drawer command bytes; assert
  the text receipt has 42-column lines and all money fields.
- Document the Windows human checklist: install a Squirrel build, select the real printer
  by name, test print, complete a cash sale, verify the drawer kicks once, power off the
  printer, complete a sale (no block), power on and reprint, and try a network printer on
  `tcp://<ip>:9100` if available.

**Verify:** E2E green; evidence note records the exact byte assertions and the unresolved
hardware items.
**Commit:** `test(pos): add receipt and drawer verification`

## Done When

Completing a sale is one crash-safe local transaction with a readable receipt number; an
80 mm receipt and (for cash) a drawer kick are produced through a swappable printer port;
and no printer failure can lose, duplicate, or block a sale.
