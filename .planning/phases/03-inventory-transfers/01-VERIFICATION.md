---
phase: 03-inventory-transfers
plan: 08
title: Phase 3 verification — Inventory & Transfers
status: verified
verified: 2026-10-18
verifier: agent (HTTP + SQL walkthrough, Playwright browser walkthroughs; screenshots in evidence/)
---

# Phase 3 — Inventory & Transfers — Verification

**Goal proven:** stock is a single, auditable truth per branch. Goods are received,
adjusted, transferred, and counted; warehouses and retail branches interoperate.

**Environment:** dev database dropped and recreated (`gikautos`), migrations applied,
`db:seed` + `db:seed --demo` run twice (the second demo run reports “demo data already
present” — idempotent), API (`:4000`) and admin console (`:3000`) running. The API
walkthrough drove the same HTTP endpoints the console uses and asserted the ledger
invariant directly in SQL; a real Chromium browser then drove the console flows against
that same database state.

**Evidence scripts** (committed for reproduction):

- `evidence/walkthrough-inventory.mjs` — HTTP + SQL walkthrough, **92/92** on the fresh
  database (includes invariant SQL, audit rows, permission matrix, warehouse guard).
- `evidence/smoke-console.mjs` — Playwright stock screens with real submissions
  (receive → GRN toast, adjust → toast, threshold → low-stock reflection), **15/15**.
- `evidence/smoke-transfers-counts.mjs` — Playwright transfer + count flows, **6/6**.

Key screenshots: `06-stock-list.png`, `06-receive-submitted.png`, `06-adjust-submitted.png`,
`06-threshold-saved.png`, `06-low-stock-updated.png`, `07-transfer-detail.png`,
`07-count-posted.png`, `07-counts-list.png`.

## Success criteria

### 1. On-hand equals the sum of movements; movements are append-only — PASS

After the full scripted mix (receipts, adjustments, transfer dispatch, partial receives,
short-close, two counts, manager operations) the walkthrough ran direct SQL:

- `stock_level.quantity_on_hand` vs `SUM(quantity_delta)` grouped per product/branch:
  **0 discrepancies**; every movement row has a projection row (0 orphans).
- The movement count strictly grew across the run (append-only in practice).
- `api/src/modules/inventory/inventory.repository.ts` contains no
  `update(stockMovement)` / `delete(stockMovement)` path (source assertion).
- Integration tests (`inventory.test.ts`) prove the same invariant plus posting
  concurrency under sorted lock order.

### 2. Receipt with supplier invoice raises stock, records cost; no payable yet — PASS

- Baseline: ACC-SPX `GIK-00001` = 6 @ GHS 45.00 (4 500 pesewas), ACC-WH1 = 40.
- Posted receipt (supplier “Walkthrough Supplies Ltd”, invoice `WS-INV-0001`,
  4 @ 5 000) → allocated **GRN-00003**; on-hand 6 → 10; branch average cost blends to the
  exact integer **4 700** (`6@4500 + 4@5000`, half-up rounding via
  `averageCostAfterReceipt` in `@gikautos/shared`); receipt detail keeps its line and
  total (20 000).
- **No `payable` table exists yet** — payables are Phase 5 scope; asserted in SQL and
  recorded below as a deviation.

### 3. Adjustments require a reason and appear in the audit log — PASS

- POST without `reasonCode` → **400**; with `DAMAGE` → **201**, level 9 → 7.
- Audit row exact match `GA-0001 | <branch> | 9 | 7 | DAMAGE` (actor staff label, branch,
  before/after level, reason).
- Adjustment below zero → **409**.

### 4. Transfers dispatch, partial receive, short-close, cost carry — PASS

- Draft WH1 → SPX (`TRF-00001`, requested 5); detail exposes source/destination on-hand
  context (40 → 10).
- Dispatch 50 of 5 requested → **400** (“more than requested”); dispatch 4 of 5 →
  source 40 → 36, status `DISPATCHED`.
- Draft requesting 45 with only 36 on hand (`TRF-00002`) → dispatch **409** “Insufficient
  stock…” (ledger guard); the refused transfer cancels cleanly.
- Over-receive (5 of 4 dispatched) → **409**; partial receive 3 of 4 → destination
  10 → 13, average blends to **4 654** (`10@4700 + 3@4500`, half-up), transfer stays
  `DISPATCHED` with 1 pending.
- Short-close with note → `SHORT_CLOSED`, note kept, `closedBy` = `GA-0001`; any further
  receive → **409**.

### 5. Stock count posts its variance as movements — PASS

- `CNT-00001` snapshot equals the level book for every line.
- Entry + post → 3 counted lines, net variance **+1**; final levels match
  current-before-post + variance (13 → 12 down, 12 → 14 up); two `COUNT_VARIANCE`
  movements carry the count reference.
- Negative guard: `CNT-00002` opened, shelf drained via adjustment, counted above zero →
  post **409 naming “Denso Air Filter Corolla”**; the open count cancels.

### 6. Warehouse cannot host POS terminals; low-stock lists are correct — PASS

- Terminal creation on the warehouse → **409** “Warehouses cannot host POS terminals”.
- Low-stock list at ACC-SPX returns **exactly** `GIK-00007` and `GIK-00011` (the seeded
  at/below-threshold rows); a threshold set equal to on-hand appears immediately
  (at/below semantics), and removal takes it out again.

## Additional verification

- **Archive guard:** product with stock → 409; a zero-stock product (auto SKU) archives
  successfully.
- **Permission matrix (manager role):** gated **403** while `mustChangePassword` is set;
  completes the forced change; other-branch stock read / receipt / adjustment / count →
  **403**; own-branch read → 200; wrong-side transfer (read, dispatch, cancel) → **403**;
  own-branch count opens (`CNT-00003`) and cancels; walkthrough restores the demo
  password (`demo-password-1234`).
- **Audit coverage:** rows present for `stock_receipt.created`, `stock.adjusted`,
  `stock_threshold.updated`, `stock_threshold.removed`, `transfer.created`,
  `transfer.dispatched`, `transfer.received`, `transfer.short_closed`, `count.created`,
  `count.updated`, `count.posted`, `count.cancelled`, `product.created`,
  `product.archived`; transfer dispatch actor is the staff label `GA-0001`.
- **Browser evidence (same fresh DB):** stock list renders 12 demo products; the low
  filter shows `Febi Rear Brake Pads` badged Low; detail history shows a `GRN-…`
  reference; the receive dialog submits and toasts “Received stock as GRN-…”, on-hand
  +2; the adjust dialog posts a `DAMAGE` reduction, on-hand −1; setting the threshold at
  the current on-hand flips the product to Low and the low-stock filter reflects it with
  the saved threshold value; screenshots for transfer draft → dispatch → receive and
  count entry → post (−1 variance) with both lists showing `TRF-…` / `CNT-…`.
- **Fresh database:** migrate → seed → demo seed twice; idempotency confirmed; warehouse
  holds all 12 demo products with `GIK-00001` = 40.
- **Quality gates:** `bun run lint` clean (263 files); `bun run check-types` clean (api,
  admin, shared, db); `bun run test` — shared 46/46, api 176/176; `bun run build`
  (admin SSR) passes.

## Deviations from plan text

1. **No payable is created by a receipt** — the roadmap criterion says “creates a
   payable”, but payables arrive in Phase 5 (Suppliers & Payables). The receipt stores
   supplier name + invoice number; the walkthrough asserts `payable` does not exist yet
   and records the Phase 5 link requirement.
2. **Transfer list gained a `direction=from|to` filter** (Plan 07): the console needs a
   “my branch” view; applied only when a branch filter resolves.
3. **Staff labels on inventory documents** (fix `7d3396b`): continuous verification
   caught raw ids in `createdBy`/actor fields; movements, receipts, adjustments, counts,
   and transfers now store the staff label (`GA-0001`).
4. **Seed test timeout raised to 30 s** (`a19c643`): demo seeding exceeds the default
   suite timeout after the Phase 3 fixture additions.
5. **Manager forced password change is exercised** by the walkthrough (403 gate →
   change → matrix → restore), so reruns leave the demo credentials intact.
6. Evidence scripts are biome-formatted with unused symbols removed; they are committed
   exactly as the (re-)run that produced the recorded 92/92 + 15/15 + 6/6 results.

## Human verification still valuable

- A visual pass over `evidence/*.png` to confirm the console styling matches taste; the
  flows themselves are machine-verified.
- Phase 5 must re-verify the receipt → payable linkage once the payables table exists.
- Phase 6 must extend the movement enum (`SALE`, opening/oversell modes) and keep the
  invariant assertion in its sync tests; `reference_number` on movements is the contract
  for offline history.
- Dev TOTP secret remains at `/tmp/opencode/admin-totp.json` (session-local, dev only).
- Known cosmetic gap unchanged: `favicon.ico` 404 in the console (Phase 9 polish).

## Commits (phase execution)

19 commits from `358405c` (Phase 3 planning) through `a19c643` (seed timeout); defect
fixes found along the way: `7d3396b` (staff labels), `a19c643` (seed timeout), `92b4001`
and `5d16ace` (cleanup + transfer on-hand context and direction filter). This
verification document and the state update follow as
`docs(planning): verify phase 3 inventory and transfers` and
`docs(planning): update state for phase 3`.
