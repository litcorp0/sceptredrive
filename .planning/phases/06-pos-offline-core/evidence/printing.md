# Plan 07 — Receipts, ESC/POS printing, and the cash drawer

Date: 2026-10-23
Scope: Phase 6 Plan 07 (sale completion, receipt rendering, printer port, drawer,
failure handling, verification hooks).

## What is proved

| Claim | Evidence |
|---|---|
| A sale writes the sale, lines, tenders, pending stock/credit/loyalty deltas, the outbox row, and clears the cart draft in **one local transaction** | `desktop/src/renderer/lib/sale/complete-sale.test.ts` (row families + injected failure leaves nothing committed) |
| The receipt number is terminal-scoped, day-scoped, and consumed inside that transaction | `desktop/src/renderer/lib/sale/document-sequence.test.ts` |
| Duplicate product lines stay separate receipt lines but aggregate into one stock movement | `complete-sale.test.ts` |
| Zero-total sales complete with no tender and print “No payment due” | `complete-sale.test.ts`, `render.test.ts` |
| Screen and paper come from one model, and every printed line is ≤ 42 columns | `render.test.ts` + packaged smoke |
| ESC/POS bytes start with `ESC @`, carry the receipt text, the drawer kick, and end with a full cut | `desktop/src/main/printing/escpos.test.ts` |
| A print failure keeps the sale, marks `FAILED`, and a retry succeeds | `print-sale.test.ts` + packaged smoke |
| A reprint is marked `*** REPRINT ***` and increments the stored count only on success | `print-sale.test.ts` + packaged smoke |
| The native printer package survives Forge packaging (including transitive deps) | packaged `app.asar` inspection + `test:print` |

Commands run:

```bash
bun run --filter desktop test        # 292/292
bun run --filter desktop check-types # clean
bunx biome check src scripts test    # clean
bun run build:pos                    # packages
bun run --filter desktop test:e2e    # 38/38 (bridge includes printer; diagnostics default off)
node test/e2e/print-smoke.mjs        # 21/21
```

## Packaged print smoke (21/21)

The script launches the packaged Linux app with `RECEIPTS_DIR` pointing at
`evidence/receipts/` and drives `#dev/print` through the real renderer → preload → main
IPC path. It asserts:

- text receipt: every line ≤ 42 columns, receipt number, `GHS 145.00`, VAT/NHIL/GETFund,
  cash + change (`GHS 55.00`), wrapped long product name, footer;
- `.escpos.bin`: starts `1b 40`; contains `1b 70 00 32 fa` (`ESC p 0 50 250`, drawer pin 2);
  ends `1d 56 00` (full cut);
- `drawer.log`: one kick per successful cash print, **none** for the failed attempt;
- failure: `.fail-next` makes the next print fail with `PRINTER_FAILED`; retry succeeds;
- reprint: `*** REPRINT ***` appears in the text;
- no CSP violations, no renderer page errors.

Artifacts: `evidence/receipts/` (text, binary, drawer log) and
`evidence/shots/plan07-print-diagnostics.png`.

`#dev/print` can open the drawer without a sale, so it is gated behind
`POS_DIAGNOSTICS=1`; the packaged app reports `diagnosticsEnabled: false` by default and the
route renders a disabled message. The security smoke asserts that default.

### Exact byte expectations

| Sequence | Bytes | Meaning |
|---|---|---|
| Initialize | `1b 40` | `ESC @` |
| Drawer kick, pin 2 | `1b 70 00 32 fa` | `ESC p 0 50 250` |
| Drawer kick, pin 5 | `1b 70 01 32 fa` | `ESC p 1 50 250` |
| Cut, full | `1d 56 00` | `GS V 0` |

## Windows human checklist (unresolved hardware)

Phase 6 CI has no physical printer. A human must run this on the target terminal:

1. Install the unsigned Squirrel build.
2. Open **Settings → Receipt printer**, choose *Windows printer queue*, find the printer,
   save, and press **Test print**.
3. Complete a cash sale: the receipt prints and the drawer opens **once**.
4. Power the printer off, complete another sale: the sale completes, the receipt shows
   `failed`, and **Retry print** works after powering on.
5. Press **Print again**: the paper says `*** REPRINT ***`.
6. If a network printer is available, switch to *Network printer*, enter `tcp://<ip>:9100`
   as host/port, and repeat 2–3.
7. Try drawer pin 5 if the drawer is wired to the second kick pin.

## Deviations and limits

- **Enrolled-device sale → print E2E is deferred to Plan 09.** It needs the API and the
  PowerSync service to enrol the device and open a shift. Plan 07 proves the same
  orchestration with unit tests plus a packaged print of a complete sample receipt.
- **`test:print` uses the fake adapter.** Native winspool cannot load on Linux; the
  Windows installer job remains the human path.
- **E-VAT fields are placeholders.** `evatSerial`, `qrPayload`, and `signature` are in the
  model and are deliberately not printed until Phase 8.
- **The fake adapter writes customer name/phone into `evidence/receipts/`.** It is a
  development/CI adapter only; production uses the real printer. The encrypted local DB
  remains the on-disk source of truth.
- **Drawer kicks are part of the receipt byte stream** (`feed → kick → cut`) for cash
  tenders. A standalone kick is available from the receipt screen when printing failed.
- **Reprint count increments on a successful reprint**, not on a failed attempt, so the
  stored count reflects paper produced.
