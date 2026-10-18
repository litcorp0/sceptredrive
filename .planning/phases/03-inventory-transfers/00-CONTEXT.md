---
phase: 03-inventory-transfers
name: Inventory & Transfers
depends_on: [01-foundation, 02-catalog-pricing]
requirements: [INV-01..09, ADM-04]
status: planned
created: 2026-10-18
---

# Phase 3 — Inventory & Transfers — Locked Context

**Goal:** Stock is a single, auditable truth per branch. Goods are received, adjusted,
transferred, and counted; warehouses and retail branches interoperate.

This document records the decisions taken with the operator before writing the plans.
It overrides convenience in any later plan.

## Locked Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Supplier payable timing (INV-03 vs Phase 5) | A receipt stores **free-text supplier name + supplier invoice number** on the receipt document; no payable, no supplier master in Phase 3. Phase 5 creates the real supplier invoice/payable and links it to the receipt | Roadmap Phase 5 SUP-03 owns payables; Phase 5 criterion "links to its stock receipt" needs a receipt document to link to. Operator decision |
| D2 | Costing | **Per-branch weighted moving average** (`stock_level.avg_cost_minor`). Re-average on **receipt** and **transfer-in** (both carry a known unit cost); outbound movement types never change it. Formula: `avg = round((avg×qty + cost×received) / (qty + received))`; when pre-move `qty ≤ 0` the new average is the incoming unit cost; `round` = half-up integer | INV-03 "branch average cost"; standard WAC (receipts blend, issues do not); integer-only |
| D3 | Negative stock in the back office | **Block** (409) any back-office operation whose result would put a branch level below zero: dispatch, negative adjustment, count posting (checked against current level). Enforced in the service layer, **not** a DB check constraint — the Phase 6 POS oversell path posts negative movements through an explicit, separate posting mode and records a reconciliation conflict | Operator decision; POS remains the only oversell path; a CHECK would block the offline sync contract |
| D4 | In-transit model | **Two-step, no transit ledger**: `DRAFT → DISPATCHED → RECEIVED` (`CANCELLED` from draft; `SHORT_CLOSED` from dispatched). Dispatch deducts the source; receive adds the destination; pending qty lives on the transfer lines | Operator decision; simplest truthful model at this scale |
| D5 | Partial receive & short-close | Receive may be called repeatedly while `DISPATCHED`; per line `received ≤ dispatched`; full receipt sets `RECEIVED`. Receiving **more** than dispatched is always 409. Short-close (destination-side, or admin) is allowed while pending > 0 and requires a note; it sets `SHORT_CLOSED` and writes an audit entry with the per-line shortfall. **No compensating movement is posted**: dispatch already removed the stock from the ledger, so the company total is already correct; the shortfall is a document state + audit record used by reporting/investigation (Phase 8) | Refines the approved option's wording (see "Refinements"); stock can never be silently lost or double-counted |
| D6 | Stock counts | Whole-branch snapshot (all products with a `stock_level` row at that branch), optional category filter (includes subcategories). Status `OPEN → POSTED` / `CANCELLED`. Variance = `counted − snapshot`; uncounted lines are skipped at post. Posting writes one `COUNT_VARIANCE` movement per variance line at the current average and is blocked (409, listing offending products) if any level would go negative. System quantity is visible while counting (no blind mode in v1) | Operator decision; Carbon/SKU.io snapshot-delta pattern so movements during the count survive |
| D7 | Low-stock thresholds | Rows exist only where set (`stock_threshold`, unique per product+branch). Low-stock list = `on_hand ≤ threshold` for those rows only; no global default | Operator decision; INV-07 |
| D8 | Inventory permissions (new) | `inventory.read`, `inventory.receive`, `inventory.adjust`, `inventory.transfer`, `inventory.count`, `inventory.threshold` — all granted to **ADMIN and MANAGER**; managers are branch-scoped. Cashiers get none (the POS reads stock through PowerSync in Phase 6) | Operator decision; all inventory mutations audited |
| D9 | Transfer creation & side authority | Any branch may draft a transfer in either direction (retail may request from warehouse). Only the **source** manager (or admin) may dispatch; only the **destination** manager (or admin) may receive/short-close. Draft is editable (lines replaceable); dispatch freezes quantities | Operator decision |
| D10 | Archive guard | Archiving a product with non-zero on-hand in **any** branch returns 409 (adjust/write off first). Branch deactivation keeps Phase 1 behaviour | Operator decision; prevents invisible "archived with stock" states |
| D11 | Document numbers | Sequenced references allocated atomically through the existing settings-sequence mechanism (pad 5): `GRN-00001` receipts, `TRF-00001` transfers, `CNT-00001` counts | Operator decision; used in lists, audit, and staff conversation |
| D12 | Movement ledger | One append-only `stock_movement` table (signed `quantity_delta`, never 0). Types: `RECEIPT`, `ADJUSTMENT`, `TRANSFER_OUT`, `TRANSFER_IN`, `COUNT_VARIANCE`. Each row carries `unit_cost_minor` (cost snapshot), `reference_type`/`reference_id`/`reference_number` (denormalized for display and Phase 6 offline history), `reason_code` (adjustments only), `note`, actor, timestamp. No update/delete helpers exist anywhere | INV-01; append-only truth; the Phase 8 movement report and Phase 6 sync read directly from it |
| D13 | Projection | `stock_level` (unique product+branch) holds `quantity_on_hand` and `avg_cost_minor`; written in the **same transaction** as movements. It is a disposable cache: `on_hand` always equals `SUM(quantity_delta)`; a reconciliation service function and tests prove it | INV-02; research pattern |
| D14 | Adjustment reason codes | Fixed enum: `DAMAGE`, `LOSS`, `FOUND`, `CORRECTION`, `EXPIRED`, `OTHER`; required on every manual adjustment, with an optional note | INV-04 "reason-coded" |
| D15 | Module layout | Three API modules in the seven-file layout: `inventory` (movements, levels, receipts, adjustments, thresholds), `transfers`, `counts`. Dependency direction (acyclic): `transfers → inventory`, `counts → inventory`, `inventory → products.repository` (product refs), `products.service → inventory.service` (archive guard) | Keeps services small; matches AGENTS.md; mirrors Phase 2 |
| D16 | Concurrency | Every posting transaction locks the affected `stock_level` rows (`INSERT ... ON CONFLICT DO NOTHING` then `SELECT ... FOR UPDATE`) in **sorted product-id order** before validating, then computes in TypeScript and updates. No DB triggers, no floats | Research: row locks + one business rule in one language; sorted order avoids deadlocks |
| D17 | Warehouse terminals (INV-09) | Creating a terminal on a `WAREHOUSE` branch returns 409; layered on the existing "branch must be active" guard. Enrollment is per terminal and inherits the guard | INV-09 "stock-only; no POS terminals" |
| D18 | Demo seed | `db:seed --demo` gains idempotent opening stock: receipts (with costs) for warehouse + Spintex, two low-stock thresholds; no transfers/counts seeded | Phase 2 D14 pattern; verification creates its own transfers/counts |

## Refinements to approved answers (flagged for operator review)

The operator approved the recommended options with two wording refinements needed for
correctness; both are conservative and match Phase 2 decisions:

1. **D5 revised mechanic:** the approved option said a short-close "posts a reason-coded
   discrepancy adjustment". Because dispatch already deducts the source (D4/D12), there
   is no balance left to write off — posting an extra movement would double-count the
   loss. The discrepancy is therefore recorded as the transfer's `SHORT_CLOSED` state +
   audit entry + per-line shortfall (visible in lists and the Phase 8 report), and no
   extra movement is written. Intent (explicit, reason-coded, never silent) is unchanged.
2. **D2 scope:** the approved option said "only receipts re-average". Transfer-in also
   carries a known unit cost, so it re-averages at the destination (standard per-location
   WAC: goods arrive at source average and blend into destination average). Outbound
   movements still never change the average.

## Architectural Invariants (do not violate)

- **Append-only stock truth.** No repository function updates or deletes a movement; no
  endpoint can edit history. Corrections are compensating movements.
- **`on_hand = SUM(quantity_delta)`** per product+branch, always, provable by
  reconciliation; the projection is disposable and rebuilt only through movements.
- **Integer everything.** Quantities are whole units (`integer`, non-zero deltas);
  money is integer pesewas; no floats in cost math.
- **Server is authoritative.** Quantities, costs, guards, and permissions are decided in
  the API; the console only renders.
- **Audit in the same transaction** as every mutation (receipt, adjustment, transfer
  transitions, count transitions, threshold changes), exactly like Phases 1–2.
- **Fail closed.** Branch access is asserted on every read and write
  (`assertBranchAccess` / `resolveBranchFilter`); managers act only on their branch.
- **No PII, no secrets.** Inventory documents carry supplier names only.

## Verified Research (see 01-RESEARCH.md)

- Ledger + disposable projection is the settled inventory pattern (banks/ERP style):
  append movements, mutate a cache in the same transaction, reconcile by replay.
- Postgres concurrency: `SELECT ... FOR UPDATE` row locks serialize writers; compute
  after locking; consistent lock order prevents deadlocks; `ON CONFLICT DO NOTHING`
  handles first-write row creation.
- WAC rules: receipts re-average; issues never do; when on-hand ≤ 0 freeze the old cost
  and adopt the incoming cost; transfers blend into the destination at the source cost.
- Transfer lifecycles in SKU.io/SAP/JDE: draft holds nothing, dispatch is the moment
  stock leaves, receive never exceeds dispatched, short receipts close explicitly.
- Counts: snapshot system qty at open, post `counted − snapshot` deltas so movements
  during the count survive; posting is atomic and irreversible.
- Drizzle 0.45.4 supports `.for('update')`, `onConflictDoNothing/Update`, and
  transactions (already used across the API).

## Bootstrap Order

1. Schema, migration, settings sequences, demo seed (Plan 01).
2. Inventory core service: ledger posting, projection, average cost, guards (Plan 02).
3. Inventory APIs: receipts, adjustments, stock, history, low stock, thresholds (Plan 03).
4. Transfers module: draft/dispatch/receive/short-close (Plan 04).
5. Counts module: snapshot, entry, post (Plan 05).
6. Console: stock, receive, adjust, thresholds (Plan 06); transfers & counts (Plan 07).
7. Phase verification and state update (Plan 08).

## Open Items (carry into later phases)

- Phase 5 links supplier invoices/payables to `stock_receipt` rows (D1).
- Phase 6 posts `SALE`/`RETURN` movement types (enum extension) and is the **only**
  oversell path (D3); movements sync to the POS with `reference_number` for offline
  history display.
- Phase 8 reports: stock value at average cost, transfer discrepancies, count history.
- Quantity decimals remain out of scope (Phase 2 D6); whole units only.
