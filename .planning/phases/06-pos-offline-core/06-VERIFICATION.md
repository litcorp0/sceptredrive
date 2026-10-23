# Plan 06 Verification — POS Selling UI

**Phase:** 06-pos-offline-core
**Plan:** 06 — catalog, cart, customers, credit, loyalty, discounts, tender hand-off
**Date:** 2026-10-23
**Verdict:** Goal achieved. A cashier can run the whole pre-payment flow offline, with every
amount produced by the shared pricing engine and no network dependency.

## Goal (from the plan)

> A cashier can find products by scan or search, build a cart that survives a crash, attach a
> customer (including creating one offline), see loyalty and credit headroom, apply permitted
> discounts or request a manager override, and reach a tender screen where cash or credit is
> selected — all from local data with no network.

## Evidence

| Gate | Command | Result |
|---|---|---|
| Desktop unit/contract tests | `cd desktop && bun run test` | **235/235** (was 74 before the plan) |
| API suite (incl. new discount cap tests) | `TEST_DATABASE_URL=…5432/gikautos_test bun run test` in `api/` | **353/353** |
| Shared suite | `cd packages/shared && bun run test` | **73/73** |
| Lint | `bun run lint` | clean (warnings only, all pre-existing/test-only) |
| Types | `bun run check-types` | 5/5 workspaces |
| Desktop package | `bun run build:pos` | packaged for linux-x64 |
| Selling-flow contract | `bun .planning/…/evidence/verify-selling.ts` | **32/32** |
| Packaged UI guards | `node .planning/…/evidence/smoke-selling-ui.mjs` | **8/8** |

### `verify-selling.ts` (32 checks)

Runs the real desktop modules in order — scanner buffer, catalogue resolution with a branch
price override, search + Enter selection, cart building, customer attach, loyalty quote and
redemption, cashier discount → manager approval, credit headroom → decision, credit tender —
then:

- parses the resulting draft with the **API's own** `uploadTransactionSchema` (strict);
- re-prices the draft's lines with the shared `priceCart` and asserts the server total, VAT,
  NHIL, GETFund, and tax-exclusive base each match what the till charged;
- asserts header/lines arithmetic, one tender equal to the total, no change on credit, the
  customer, the redemption, the promoted line approval, the stable idempotency key, the
  server-computable earn preview, and cash change arithmetic.

This found two real defects before any code shipped:

1. **The percentage floor let a cashier discount under 1% of a large cart with no approval**
   (a GHS 2.00 line discount on a GHS 280.50 cart floored to "0%"). The cap is now compared in
   **pesewas** on both client and server: `totalDiscount > floor(gross × cap%)`.
2. A test scenario that did not fit the credit limit — i.e. the credit decision was correct.

### `smoke-selling-ui.mjs` (8 checks, packaged binary over CDP)

`#pos`, `#pos/tender`, and `#pos/settings` each redirect to `#login` when no staff session
exists; the diagnostics shell still renders; no page errors; no CSP violations; the renderer
still has no Node globals.

## Task-by-task

| Task | Delivered | Notable decisions |
|---|---|---|
| 1 — shell, guard, cart draft | Guarded `PosRoutes` (session → terminal config → shift → manager-only settings), app header (branch/terminal/shift/cashier/connectivity/outbox), cart reducer with enforced invariants, local `cart_draft` + `cart_draft_line` persisted 150 ms after each change in one transaction and restored when the shift matches, F-keys and line navigation | The draft id **is** the future sale id, so Plan 07 reuses it as the receipt/outbox key. A corrupt draft is sanitised rather than trusted. `routes/_pos/route.tsx` was folded into `routes/_pos/app.tsx` (its placeholder shell was superseded) |
| 2 — search, scan, grid | Parameterised local search (barcode, SKU, name, browse) with escaped wildcards, debounced 150 ms, virtualised 2-column grid (`@tanstack/react-virtual` 3.14.22), branch price via `resolveEffectivePrice`, stock badge with pending deltas, keyboard-wedge detector (≤ 60 ms per character) | SQL was exercised against a real SQLite schema, including `%`/`_` escaping and an injection payload. Out-of-stock products remain sellable |
| 3 — customers | Synced + draft search, digit-based phone matching, offline draft creation with uuidv7 and normalisation, duplicate detection, customer rail with credit/loyalty badges | Only name + phone are collected: the upload contract has no email field. A draft is a real identity, not a throwaway |
| 4 — loyalty | Earn preview from the tax-exclusive base, available balance with pending deltas, expiring-soon hint, redemption quote with minimum/balance rules, pre-tax discount, live new total, zero-total support | Redemption is capped at the cart net so points are never burnt for no discount; the panel shows the chosen points rather than reconstructing them from money |
| 5 — credit and overrides | Headroom (limit − balance − pending), decision matrix (`OK`/`OVER_LIMIT`/`HOLD`/`NO_PROFILE`/`NO_CUSTOMER`), manager binding + PIN approval, proof stored on the cart, continue-without-approval path | A cashier binding is refused **before** the PIN is checked; the manager's own lockout counters apply |
| 6 — discounts | Amount/percent entry, reason codes, live percent-of-base, cap warning, manager approval routing on the *resulting* discount, line + sale discounts, totals panel from `priceCart` | Server aligned (operator-approved): the cap measures **all** discounts over gross, in pesewas. Approval proof rides on `saleDiscount.override`, including for line approvals |
| 7 — tender | Cash keypad/quick notes/exact/change, credit decision + approval, zero-total "no payment due", sale draft built for Plan 07, receipt number peeked from the daily sequence | The screen does not write the sale (Plan 07 owns the commit, printing, and the drawer). The draft is final and schema-validated |

## Deviations

1. **Server discount cap changed** (operator-approved): total discounts over gross in pesewas,
   not the sale discount over net. New API tests cover the line-discount bypass, a line approval,
   and a sale discount above the cap.
2. **Local schema gained `product.tax_category`** (additive, D10 allows it): the terminal cannot
   price tax without it. PowerSync adds the column on existing devices.
3. **`routes/_pos/route.tsx` removed**; the shell lives in `routes/_pos/app.tsx`.
4. **`cart_draft` / `cart_draft_line` added to `lib/powersync/schema.ts`** rather than a separate
   `local-schema-extension.ts`: there is one local schema file and a second one would invite drift.
5. **The tender screen ends at a "Sale ready" dialog** that summarises the final draft (receipt
   number, tender, change, totals) and states that recording and printing arrive with sale
   completion. Plan 07 replaces that dialog's action with the write + print flow.

## Not covered here (carried forward)

- **Data-path E2E** (enrolled device → PIN → shift → scan → cart → tender → completed sale →
  restart → upload → conflict badge): needs the API and the self-hosted PowerSync service. It is
  the **Plan 09** gate per D36, and Plan 07 is a prerequisite (there is no completed sale yet).
- **Physical hardware**: 80 mm ESC/POS printer, cash drawer, and keyboard-wedge scanner for the
  human pass (Plan 07/09).
- **Honesty about scope**: in this plan the sell screen can build and review a sale but not record
  it. That is the plan's design: Plan 07 owns sale completion, receipts, printing, and the drawer.

## Human verification checklist

1. Enrol a terminal, sign in with the offline PIN, open a shift.
2. Scan a seeded barcode → one line appears with the branch price; quantity +/− works.
3. Search a partial name → Enter adds the only result; an unknown scan shows the code.
4. Kill the app (or `SIGKILL` the process), relaunch → the cart and its customer are restored.
5. Create a customer offline with `024 123 4567` → rail shows "will link on sync"; the same phone
   again offers the existing person.
6. Redeem 250 points → pre-tax discount, tax recomputed, total drops; remove → totals restore.
7. As a cashier, set any discount → manager PIN required; wrong PIN fails, manager PIN applies.
8. Credit within the limit selects directly; over-limit opens the manager dialog and still offers
   "continue without approval".
9. Tender: exact cash, oversize cash (change), credit, and a fully redeemed zero-total sale all
   reach "Sale ready" with the expected receipt number and totals.
