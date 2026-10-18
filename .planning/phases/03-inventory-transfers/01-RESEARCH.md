# Research — Phase 3: Inventory & Transfers

**Researched:** 2026-10-18
**Sources:** ERP/WMS practitioner write-ups (Quotery append-only ledger, matthewswong.com
ledger + concurrency, destm.com inventory stream, cleverence ledger pattern), Acrruent
WAC business rules, Axolon ERP weighted-average costing, BANA per-location costing PRD,
SKU.io transfer/count docs, SAP EWM quantity-difference docs, JDE cycle-count guidance,
Carbon inventory-count docs, InventoryOnline cycle counting, PostgreSQL 18 explicit
locking docs, Drizzle ORM docs, Phase 1–2 codebase patterns.

## 1. Ledger + projection is the settled inventory pattern

- **Stock is a ledger, not a column.** Every receipt, issue, transfer, and adjustment is
  an immutable signed row; balances are sums. Edits/deletes are forbidden; corrections
  are compensating rows. This gives a free audit trail and makes "why is it 38 not 40?"
  answerable by a query. (Quotery, matthewswong.com, destm.com)
- **The projection is a cache.** `stock_level` (qty + average cost) is written in the
  same transaction as the movement insert and is always re-derivable by replaying the
  ledger. Rebuild/reconciliation is a pure projection: group movements, compare, repair,
  log. (matthewswong.com, Quotery)
- **Reference discipline.** Each movement carries a reference to the document that
  caused it, which is what makes discrepancy investigation possible. We denormalize the
  human reference (`GRN-00001`, `TRF-00007`) onto the movement so the Phase 6 POS can
  show movement history offline without joining document tables.
- **Monthly snapshots are the standard performance answer** (sum movements after the
  last snapshot). Not needed at 5 branches / 5k SKUs; noted for Phase 8+ if reports on
  the raw ledger get slow.

## 2. Postgres concurrency for stock writes

- **Check-then-write in application code alone races.** Two concurrent outs both read
  on-hand 5 and both pass. Wrapping SELECT + UPDATE in a transaction does not fix it
  under Read Committed — either collapse into one statement or take an explicit row lock.
  (PostgreSQL docs 13.3, matthewswong.com flash-sale write-up)
- **Two correct patterns:** (a) atomic `UPDATE ... SET qty = qty - x WHERE qty >= x
  RETURNING` (check inside the statement) or (b) `SELECT ... FOR UPDATE` then compute.
- **Chosen: lock-or-create + compute in TypeScript.** Because receipts need the old
  average cost to compute a new one with business rules (rounding, reset-at-≤0), and
  because the same rule must be unit-testable in one language, we:
  1. `INSERT ... ON CONFLICT DO NOTHING` to guarantee the level row exists,
  2. `SELECT ... FOR UPDATE` to serialize writers on that product+branch,
  3. compute in TS, update the projection, insert movements, commit.
  Lock acquisition is ordered by product id (sorted) so multi-line documents cannot
  deadlock against each other. (Raktim Ranjit "stock balances in application code"
  argues this against DB triggers; Sentry-WMS shows the same lock discipline.)
- **First-write race:** `ON CONFLICT DO NOTHING` handles two concurrent first-moves for
  a product+branch; one inserts, the other no-ops, both then lock and proceed.
- **Do not add a `CHECK (quantity >= 0)`:** Phase 6's offline POS oversell path must be
  able to post negative movements through an explicit posting mode (SYNC-05 conflict).
  The back-office guard is service-level; tests prove it.

## 3. Weighted moving average (per branch)

- **Golden rule:** `Average = Value of stock on hand ÷ Quantity on hand`. Receipts blend
  in at the purchase price; issues leave at the current average and never change it.
  (Axolon ERP costing docs)
- **Receipt formula:** `newAvg = (oldAvg×oldQty + receiptCost×receivedQty) /
  (oldQty + receivedQty)`. Adjustments downward leave the average alone; upward
  adjustments without an explicit cost also leave it alone. (Acrruent WAC rules)
- **Zero/negative on-hand:** when the pre-receipt quantity is ≤ 0, freeze/ignore the old
  cost and adopt the incoming lot's cost outright (no divide-by-zero, no ghost value).
  (BANA inventory-valuation PRD)
- **Per-location costing:** each branch keeps its own average; goods transferred from a
  warehouse arrive at the warehouse's average cost and **blend into the destination's
  average**. Transfers never create profit/loss. (Axolon §6, Traede)
- **Integer math (pesewas):** `round((avg*qty + cost*recv) / (qty + recv))` with
  `Math.round`; all inputs validated as non-negative safe integers; residual is at most
  a pesewa and never re-averages without a receipt.

## 4. Transfer lifecycle

- **Draft holds nothing; dispatch is the moment stock leaves.** Drafts are editable and
  have no stock effect; shipping removes source on-hand; receiving adds destination.
  Partial ship/receive is normal and keeps the document open; a full receipt closes it.
  (SKU.io "How warehouse transfers work")
- **State-by-state stock effects** (Jodoo transfer form guide): Approved = no change;
  Dispatched = source −qty, in-transit +qty; Received = in-transit 0, destination
  +accepted. With our two-step model the in-transit column is virtual (pending = dispatched
  − received on the document), so company-wide truth stays correct without a transit
  ledger: dispatch already removed the units, receive re-adds what arrived, and the
  remainder is visible on the transfer until it is received or short-closed.
- **Short receipts close explicitly, never by editing.** SAP/EWM posts quantity
  differences; SKU.io requires a receiving-discrepancy action to close a shortfall.
  Receiving more than was shipped is a data-entry error and is rejected. (SAP EWM qty
  differences, SKU.io receive-a-transfer)
- **Reconciliation lives on the document:** dispatched vs. received vs. pending per
  line, with a note and actor on close — enough for Phase 8's discrepancy report.

## 5. Stock counts

- **Snapshot then post the delta.** Freeze system quantities when the count opens;
  variance = `counted − snapshot`; post that delta, not the counted quantity. A
  movement that lands while the count is open therefore survives instead of being
  clobbered, and the counter's variance is exactly what they reviewed. (Carbon
  inventory counts)
- **Posting is atomic and irreversible:** one adjustment (positive or negative) per
  varying line, written to the ledger with the count as the reference; corrections
  afterwards are new compensating movements. (Carbon, InventoryOnline)
- **Blind vs informed:** blind counting (hiding the system figure) is a quality
  feature, not a correctness one; v1 counts are informed (operator decision D6).
- **Freeze guidance from older ERPs** (JDE/TECSYS: "don't move stock while counting")
  is a procedural mitigation; the snapshot-delta posting makes it non-fatal, so v1 does
  not block sales/movements during a count.

## 6. Codebase patterns to reuse (Phases 1–2)

- Seven-file module layout; `db.transaction` + `writeAudit(actor, tx)`; controllers via
  `actorFromContext(c)`; Zod through `validateJson/validateQuery/validateParam`;
  `resolveBranchFilter` / `assertBranchAccess` / `branchScope` for scoping.
- Settings sequences: `allocateFromSequence` / `peekSequenceValue` /
  `advanceSequencePast` with `SequenceKey` + `SEQUENCE_FORMATS` — extend with
  `inventory.receipt*`, `inventory.transfer*`, `inventory.count*` (pad 5).
- Product ref validation lives in `products.repository` (`findProductById`); catalog
  helpers (`listChildCategoryIds`) exist for category filters.
- Tests: unit + integration against `gikautos_test` via `bun run db:test:prepare`;
  fixtures seed cross-module rows with Drizzle and track ids for cleanup; suites run in
  parallel, so every created id must be scoped.
- Console: hand-maintained `api-types.ts` / `api.ts`, `hasPermission` gating, shared
  `PageHeader`, `Pagination`, `ConfirmDialog`, `TableMessage`, `toastApiError`,
  TanStack Query keys, branch context switcher, `formatGhs`/`parseGhsToMinor`.
- Demo seed: `ensure*` helpers are idempotent; `--demo` runs after base seed.

## 7. Schema notes (Drizzle 0.45.4 / Postgres 18)

- Enums via `pgEnum`; signed integer deltas; `unique(product_id, branch_id)` on levels
  and thresholds; `unique(transfer_id, product_id)` / `unique(count_id, product_id)` on
  lines; `unique(number)` on documents.
- Indexes: `stock_movement(product_id, branch_id, created_at)` for history,
  `(branch_id, created_at)` for branch feeds, `(reference_type, reference_id)` for
  tracing, `(type, created_at)` for Phase 8 reports. `stock_level(branch_id)` for lists.
- Timestamps `timestamptz` with `$onUpdate` where mutable (levels, transfer/count docs);
  movements are insert-only.
- All tables use uuid PKs so Phase 6 PowerSync can mirror them (PowerSync adds its own
  `id` semantics locally; server uuids stay stable for reconciliation).
- Enum growth (Phase 6 `SALE`, `RETURN`) is an additive migration — safe.

## 8. Design notes / pitfalls

- **Do not** write movements from two code paths: everything goes through
  `inventory.service.postMovements` (single writer rule), including transfers and counts.
- **Do not** read-then-write without locking, even for "safe" increments.
- **Do not** recompute historical average cost retroactively: late supplier invoices
  (Phase 5) update forward, not backwards (BANA FR-010 rationale). Phase 3 receipts
  capture the cost at posting time.
- **Multi-line atomicity:** one document = one transaction; a single failed line rolls
  the whole document back (no half-dispatched transfers).
- **Receive cannot reference an archived product** (409) — prevent resurrecting dead
  SKUs; adjustment likewise. Counts skip archived products at snapshot.
- **Display:** movement history shows reference number, reason, signed qty, unit cost,
  actor, and timestamp — enough for an operator to explain any balance without opening
  the audit log.
