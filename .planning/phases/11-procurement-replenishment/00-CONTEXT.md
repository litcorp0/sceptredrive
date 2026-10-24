---
phase: 11-procurement-replenishment
name: Procurement, Replenishment & Supplier Returns
depends_on: [03-inventory-transfers, 05-suppliers-payables, 07-identity-design-system, 08-admin-modules-shell, 10-desktop-pos-redesign]
requirements: [PROC-01, PROC-02, PROC-03, PROC-04, PROC-05, PROC-06, PROC-07, PROC-08, PROC-09, PROC-10, MGR-01, MGR-02, MGR-03, MGR-04, MGR-05]
status: context-locked
created: 2026-10-24
---

# Phase 11 — Procurement, Replenishment & Supplier Returns — Locked Context

**Goal:** A manager can decide what to order from the numbers on screen, raise a purchase
order, get it approved when it matters, receive the goods against what was ordered, send back
what is wrong, and see which suppliers actually deliver.

## Problem

Stock can only enter the system by recording a supplier invoice **after delivery**. There is
no order, so nobody knows what is coming, the branch cannot prove what it asked for, and a
short delivery is invisible. `supplier_product` already stores `lead_time_days`,
`last_cost_minor`, and `is_preferred`, but no code reads them. Low stock is a single
`threshold` with no target quantity, so "what should I order?" is still a guess.

## Locked Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Purchase order lifecycle | `DRAFT → PENDING_APPROVAL → APPROVED → SENT → PARTIALLY_RECEIVED → RECEIVED → CLOSED`, plus `REJECTED` and `CANCELLED`. The order is its own requisition; no separate requisition document | One document the manager can reason about. A separate requisition would double the UI for a five-branch business |
| D2 | Approval threshold | New setting `procurement.approvalThresholdMinor`, default **1_000_000** pesewas (GHS 10,000), branch-overridable, admin-only to change. At or above the threshold the order waits for an admin decision; below it, a manager's order is approved automatically | Operator decision 2026-10-24. Configurable so the owner can tighten or loosen without a release |
| D3 | Immutability | A `DRAFT` order is editable. Once approved, lines and prices are immutable; changes happen by cancelling and re-raising, or by a recorded amendment note | Mirrors the append-only discipline of the ledgers |
| D4 | Receiving | Goods receipts are new rows linked to order lines; the existing `stock_receipt` path posts the stock movement and average cost. Full, partial, short, and over deliveries are all representable. Over-receipt needs a reason and is recorded as a discrepancy; it is never silently truncated | Reuses the Phase 3 ledger instead of inventing a second stock write path |
| D5 | Invoice matching | `supplier_invoice` gains a nullable `purchaseOrderId`. Matching is **advisory**: a price or quantity variance sets a flag with both values and the payable still posts. An invoice may arrive before the order is complete | Payables must never be blocked by a documentation gap; the variance is the reconciliation hook |
| D6 | Purchase returns | New `supplier_return` + lines, settled by a **credit note** that reduces the supplier balance, posting a `SUPPLIER_RETURN` stock movement. The original receipt is never edited | Operator decision. Append-only; a return is a new fact, not a correction |
| D7 | Min/max | `stock_threshold` gains `max_quantity` and `reorder_quantity`. Defaults: max = 2× min, reorder = max − on hand | One extra row shape, no new table; existing thresholds keep working with max defaulted |
| D8 | Suggestion formula | `suggested = clamp(max_level − on_hand − on_order, 0, max_level)`, with `max_level` raised to `ceil(daily_velocity × (lead_time_days + safety_days))` when that is larger. `daily_velocity = units sold in the last 90 days / 90`. Every step is integer arithmetic, rounded up once at the end, and the screen shows the inputs | Explainable arithmetic a manager can audit, not a black box. Deterministic so the same inputs give the same suggestion |
| D9 | On-order quantity | Sum of open purchase order lines (approved, not fully received), so a suggestion does not double-order | Prevents the classic "ordered twice because the first order was not counted" |
| D10 | Supplier performance | Computed read model from orders and receipts: on-time rate, fill rate (`received / ordered`), actual lead time (sent → first receipt), and last-cost drift versus the previous receipt. No new tables | Derived from facts already stored once the order exists |
| D11 | Numbering | `PO-{BRANCHCODE}-{YYYYMM}-{NNNN}` and `PR-{BRANCHCODE}-{YYYYMM}-{NNNN}` through the existing settings sequence machinery, allocated inside the transaction | Same contract as receipts, transfers, and invoices |
| D12 | Permissions | New: `procurement.read`, `procurement.create`, `procurement.approve`, `procurement.receive`, `procurement.return`. Manager gets read/create/receive/return; admin gets all. `supplier.create` and `catalog.update` are granted to the manager. `catalog.create` is granted to the manager but is **approval-gated** per D16 — the service raises a `PRODUCT_CREATE` request instead of inserting. `catalog.archive` and price policy stay admin | Operator decision on manager autonomy. Approve is admin-only for orders, with the threshold deciding whether it is needed at all |
| D13 | Money | Line cost and totals are integer minor units. Receiving updates `supplier_product.last_cost_minor` and the branch average cost through the existing Phase 3 logic. No float anywhere, including the suggestion | AGENTS.md rule 4 |
| D14 | Offline | Procurement is admin/manager only and online-only. The POS, its outbox, and its sync streams are untouched | The till must not gain a dependency on a purchasing flow |
| D15 | Verification | Fresh-DB cycle; unit tests for threshold resolution, suggestion arithmetic, receipt quantities, return credit; API walkthrough (order below/above threshold, partial then short receipt, over-receipt with reason, invoice variance, return credit note, reconciliation); console walkthrough with screenshots; existing suites unchanged | Goal-backward; every number must reconcile |
| D16 | Manager product creation | A manager **submits** a product (name, category, unit, proposed base price, supplier). A `PRODUCT_CREATE` approval is raised; the product row is created only when an admin approves it. Rejection creates nothing | Operator decision. Keeps one branch's price from setting every branch's price, with no pending-product state to carry through the POS sync schema |
| D17 | New part from a supplier | Receiving a part that has no `supplier_product` row creates it with the receiving supplier, the line's unit cost as `last_cost_minor`, and a null lead time. It is **not** created on purchase-order creation, because a cost is only a fact once goods arrive | The current `recordInvoiceCosts` deliberately no-ops for unmapped products, which is why a new part today has no lead time and no cost history |
| D18 | Catalogue cost | `product.costPriceMinor` becomes **derived and read-only**: it follows the latest receipt cost for the product, and the branch figure shown in the UI is `stock_level.avgCostMinor`. The column stays for products with no stock yet, but no screen writes it | Two cost fields that drift is how margin reports lose trust. `sale_line.unit_cost_minor` remains the frozen historical basis |
| D19 | Profit basis | Gross profit per line is `net_minor − unit_cost_minor × quantity`, using the snapshot written at sale time. Phase 9 reports it; Phase 11 only guarantees the inputs (receipts, returns, derived cost) are correct | The snapshot already exists (`pos.service.ts`), so margin is historically stable without new tables |

## Invariants

- The stock ledger gains rows only. Receiving and returning post movements; nothing is edited.
- Payables reconcile: invoice + credit note = supplier balance, always.
- An approved order cannot be changed, only cancelled or amended by a new document.
- A suggestion is arithmetic on stored facts, never a cached forecast.
- No procurement action can be initiated from, or block, the POS.

## Planned Plans

1. Schema, enums, settings, permissions, seed.
2. Approvals core (shared with Phase 12) and threshold resolution, including `PRODUCT_CREATE`.
3. Purchase order lifecycle API; manager product submission endpoint.
4. Receiving against orders, supplier-product link auto-creation, discrepancy handling, invoice matching.
5. Purchase returns and supplier credits.
6. Replenishment service and suggestion arithmetic, including parts never stocked at a branch.
7. Supplier performance read model and derived catalogue cost.
8. Console UI: ordering, receiving, returns, replenishment.
9. Verification, evidence, state update.
