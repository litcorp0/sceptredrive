---
phase: 06-pos-offline-core
plan: 06
wave: 4
title: POS selling UI — catalog, cart, customers, credit, loyalty, discounts
requirements: [POS-05, POS-07, POS-08, POS-09, POS-14]
depends_on: [03, 04]
status: planned
created: 2026-10-22
---

# Plan 06 — POS Selling UI

**Goal:** A cashier can find products by scan or search, build a cart that survives a crash,
attach a customer (including creating one offline), see loyalty and credit headroom, apply
permitted discounts or request a manager override, and reach a tender screen where cash or
credit is selected — all from local data with no network.

## Task 1 — POS shell, session guard, and cart draft persistence

**Files:** `desktop/src/renderer/routes/_pos/route.tsx`,
`desktop/src/renderer/routes/_pos/index.tsx` (redirect to `/sell` or `/shift`),
`desktop/src/renderer/routes/_pos/sell.tsx`,
`desktop/src/renderer/routes/_pos/settings.tsx`,
`desktop/src/renderer/components/pos/app-header.tsx`,
`desktop/src/renderer/lib/cart/cart-store.tsx`,
`desktop/src/renderer/lib/cart/cart-repository.ts`,
`desktop/src/renderer/lib/db/local-schema-extension.ts`

- Layout: compact top bar with branch/terminal, cashier name, shift state, online/pending
  badge placeholder (wired in Plan 08), lock button, settings; main area for search/cart;
  right rail for customer/loyalty/credit; large touch targets, keyboard shortcuts, no
  hover-only actions. Dense neutral POS theme consistent with the admin (zinc tokens,
  system font), but larger type and contrast for a counter screen.
- Route guard: requires an in-memory staff session (Plan 04); redirects to `/login`;
  redirects to `/shift` when no open shift and `pos.salesRequireOpenShift`; `/settings`
  requires a MANAGER/ADMIN binding (printer/test print lives in Plan 07).
- Add local-only `cart_draft` (one row per terminal: id, shift_id, customer_id,
  updated_at, totals json) and `cart_draft_line` (draft_id, line_number, product_id,
  quantity, unit_price, line_discount, tax_category, name/sku snapshot). Persist the cart
  after every mutation (debounced ~150 ms) in one transaction; restore on app start if the
  shift matches. Clear on completed sale or explicit void.
- `cart-store.tsx`: reducer actions `addProduct`, `setQuantity`, `removeLine`,
  `setLineDiscount`, `setSaleDiscount`, `setCustomer`, `setLoyaltyRedeem`, `clear`,
  `hydrate`. Derived values come from `priceCart` (shared) — never recompute money in
  components. Guard: quantity integer ≥ 1, discounts clamped, no negative totals.
- Keyboard: `F2` focus search, `F4` customer, `F6` loyalty, `F8` discount, `F9` pay,
  `Esc` clear/close dialog, `+/-` quantity when a line is focused. A global key handler
  ignores events while a dialog/input is focused.

**Verify:** unit tests for reducer invariants and draft round-trip; E2E add two lines,
kill the app, relaunch → cart restored; no shift → redirected.
**Commit:** `feat(pos): add selling shell and crash-safe cart`

## Task 2 — Product search and barcode scan

**Files:** `desktop/src/renderer/lib/catalog/search.ts`,
`desktop/src/renderer/components/pos/product-search.tsx`,
`desktop/src/renderer/components/pos/product-grid.tsx`,
`desktop/src/renderer/components/pos/scan-listener.ts`,
`desktop/src/renderer/lib/catalog/pricing.ts`

- Local queries: exact active barcode first; then SKU exact; then name `LIKE %q%`
  (case-insensitive) ordered by name; cap 50. Use `useQuery` with a debounce (150 ms) and
  parameters; no network.
- Barcode wedge listener: accumulate printable characters terminated by `Enter` within
  ~50 ms per char; ignore when an input has focus unless it is the search field; on scan,
  exact match → add 1 (or increment an existing line), unknown → inline "Not found" toast
  with the code and a search shortcut. Do not use a global keylogger library.
- Product card: name, SKU, effective branch price (`resolveEffectivePrice`), stock badge
  from synced + pending deltas (negative shows "oversold" in amber, never blocks), tax
  category chip. Tap/enter adds one.
- Search results show out-of-stock products too (sale allowed); archived products are not
  synced.
- Performance: virtualize large result lists (5k SKUs) and avoid re-querying on every
  keystroke; index by barcode/sku in the local schema.

**Verify:** unit tests for query selection and scanner buffer; E2E scan a seeded barcode
adds a line, unknown code shows the message; search by name/sku; price matches the admin
override.
**Commit:** `feat(pos): add local product search and barcode scanning`

## Task 3 — Customer lookup and offline creation

**Files:** `desktop/src/renderer/lib/customers/search.ts`,
`desktop/src/renderer/lib/customers/create-draft.ts`,
`desktop/src/renderer/components/pos/customer-panel.tsx`,
`desktop/src/renderer/components/pos/customer-dialog.tsx`,
`desktop/src/renderer/components/pos/customer-create-dialog.tsx`

- Search synced `customer` + local `customer_draft WHERE acked_at IS NULL` by normalized
  phone (use `normalizeGhanaPhone`/digit suffix) and name; show branch credit badge
  (limit/balance from `credit_profile` + pending deltas) and loyalty points.
- Selecting a customer sets the cart customer and enables credit/loyalty. "Walk-in" clears
  it. Changing the customer after a credit tender is selected resets the tender.
- Create dialog: name (required), phone (required, normalized; inline error for invalid
  Ghana numbers), email optional. Reject a phone that matches a synced customer (select
  that customer instead). Insert `customer_draft` with UUIDv7 + phone; usable immediately.
  The draft is marked `pending_link`; no server call.
- The panel shows "New customer — will link on sync" when a draft is selected.
- After Plan 08 ack, drafts get `linked_customer_id`; the UI then switches to the synced
  customer on the next cart.

**Verify:** unit tests for normalization/dedupe against synced customers; E2E create a
draft offline, attach it to a cart, restart → still attached; invalid phone blocks save.
**Commit:** `feat(pos): add offline customer lookup and drafts`

## Task 4 — Loyalty panel and redemption

**Files:** `desktop/src/renderer/components/pos/loyalty-panel.tsx`,
`desktop/src/renderer/components/pos/loyalty-redeem-dialog.tsx`,
`desktop/src/renderer/lib/loyalty/quote.ts`,
`desktop/src/renderer/lib/loyalty/balance.ts`

- Show global balance + pending delta, expiring-soon points (from synced live lots within
  30 days), and the current earn preview for the cart (`floor(earnBase × rate / 100)`,
  hidden below 1 point).
- Redeem dialog: points input with the current rate, minimum redemption hint, max =
  available balance + pending; live value and new total via `priceCart`; confirm applies
  `loyaltyRedeemPoints` to the cart and shows the discount as a line under the totals
  labeled "Loyalty redemption (pre-tax)". No network.
- If the cart's earn base is 0, earn preview shows "0 points".
- Redemption can make the total zero; the tender screen then allows a zero-total cash sale
  (no cash tender) or credit 0 — Phase 6 handles this as a valid fully-redeemed sale.
- Manager override is not needed for redemption within the cached balance.

**Verify:** unit tests for quote/minimum/zero-total; E2E redeem points offline and see the
pre-tax discount and recomputed tax; remove the redemption restores totals.
**Commit:** `feat(pos): add offline loyalty earn preview and redemption`

## Task 5 — Credit headroom and manager override

**Files:** `desktop/src/renderer/components/pos/credit-panel.tsx`,
`desktop/src/renderer/components/pos/manager-override-dialog.tsx`,
`desktop/src/renderer/lib/credit/headroom.ts`,
`desktop/src/renderer/lib/overrides/override-service.ts`

- `headroom = limit − (balance + pending charges)` for the cart's branch/customer; show
  limit, balance, pending, available. No profile → "No credit account at this branch"
  (a charge will bootstrap one server-side; headroom is 0 until a limit is set).
- Credit tender is offered only with a customer; if the total ≤ headroom and the profile is
  not on hold, select it directly. If over limit or on hold, open the manager override
  dialog: manager binding selection + PIN (Plan 04), reason code (`CUSTOMER_REQUEST`,
  `APPROVED`, `OTHER`) + note, live "over by" amount. On success store
  `{ approverStaffId, approverUserId, bindingId, pinVersion, reasonCode, note,
  approvedAt }` on the tender draft.
- The override dialog never blocks the sale: "Continue without approval" is available and
  records the over-limit intent; the server will raise the conflict. The UI warns clearly
  that the debt is still recorded.
- Manager PIN verification failures respect the manager's own lockout; a cashier cannot
  approve their own override (binding role check).
- Credit tender amount is fixed to the cart total in Phase 6 (no split); cash is the
  remainder for Phase 7 later.

**Verify:** unit tests for headroom with pending deltas and over-limit math; E2E within
limit selects credit without a dialog; over-limit demands a manager PIN; wrong PIN does not
approve; override fields persist in the cart draft.
**Commit:** `feat(pos): add credit headroom and manager overrides`

## Task 6 — Discounts and reason codes

**Files:** `desktop/src/renderer/components/pos/discount-dialog.tsx`,
`desktop/src/renderer/lib/discounts/discount-service.ts`,
`desktop/src/renderer/components/pos/cart-line.tsx`,
`desktop/src/renderer/components/pos/cart-totals.tsx`

- Line discount: amount in GHS (parsed to pesewas) or percentage with a live preview;
  cannot exceed the line gross. Sale discount: amount or percentage, allocated by the
  shared engine. Reason code required (`STAFF`, `DAMAGE`, `PROMO`, `OTHER`) + optional
  note.
- Cap check: cashier discount total ≤ `pos.maxCashierDiscountPercent` of gross; above that
  requires `pos.discount` authority (manager/admin) via the same manager PIN dialog. A
  manager may discount up to `pos.maxManagerDiscountPercent`. The dialog shows the cap and
  the amount over it.
- Totals panel: gross, line discounts, sale discount, loyalty redemption, taxable base,
  VAT, NHIL, GETFund, total, item count; every value from `priceCart`.
- Removing a discount recomputes tax immediately; the cart draft persists the discounts
  and reason codes.

**Verify:** unit tests for cap boundaries (exactly at cap, one pesewa over), percentage
rounding, reason requirement; E2E cashier at 0% cannot discount without a manager; manager
approves; totals and tax update.
**Commit:** `feat(pos): add permissioned line and sale discounts`

## Task 7 — Tender screen hand-off

**Files:** `desktop/src/renderer/routes/_pos/tender.tsx`,
`desktop/src/renderer/components/pos/tender-panel.tsx`,
`desktop/src/renderer/lib/sale/sale-draft.ts`

- Tender screen shows the final total, cash/credit choice, and the sale-draft object that
  Plan 07 will commit (lines, discounts, loyalty, customer draft, overrides, totals,
  tender). It does not write the sale yet.
- Cash: quick-cash buttons (exact, 10/20/50/100/200 GHS), numeric keypad, change preview.
  Credit: shows headroom/override status.
- "Complete sale" is disabled while a required manager override dialog is unresolved only
  when the cashier chose to require approval; "Continue without approval" is always
  available for credit over-limit.
- Zero-total sale (fully redeemed) skips cash entry and shows "No payment due".
- Back returns to the cart with state intact.

**Verify:** E2E builds a cart, applies loyalty, reaches tender, changes tender, backs out,
and the cart is unchanged; credit without a customer is impossible.
**Commit:** `feat(pos): add tender selection and sale draft hand-off`

## Done When

A cashier can run the whole pre-payment flow offline — scan/search, cart survive a crash,
find or create a customer, see loyalty and credit, obtain a manager override where needed,
apply permitted discounts, and choose cash or credit — with all money computed by the
shared engine and no network dependency.
