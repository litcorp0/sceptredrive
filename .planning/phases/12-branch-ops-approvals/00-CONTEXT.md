---
phase: 12-branch-ops-approvals
name: Branch Operations & Approval Workflow
depends_on: [10-desktop-pos-redesign, 11-procurement-replenishment]
requirements: [APR-01, APR-02, APR-03, APR-04, APR-05, APR-06, BRN-01, BRN-02, BRN-03, BRN-04, BRN-05, CC-01, CC-02, CC-03, CC-04, CC-05]
status: context-locked
created: 2026-10-24
---

# Phase 12 — Branch Operations & Approval Workflow — Locked Context

**Goal:** The branch manager can request what the branch needs and the admin can decide,
with one queue, one audit trail, and no path where stock, price, credit, or cash changes
without a decision that names the person who made it.

## Problem

`transfer` starts at `DRAFT` and a manager holding `inventory.transfer` can create a pull
from any branch or warehouse **and dispatch it themselves**. There is no way to write off
damaged stock, no way for a manager to change a price beyond editing the catalogue, no way to
propose a credit limit, and a shift variance is recorded but never reviewed. There is no
approval entity in the system at all.

## Locked Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Approvals entity | One `approval` table introduced in Phase 11 and extended here: `type`, `entityType`, `entityId`, `branchId`, `amountMinor`, `status`, `requestedBy`, `requestedAt`, `decidedBy`, `decidedAt`, `reasonCode`, `note`, `before`/`after` jsonb, unique on `(type, entityId)` while open | One inbox, one audit shape, one set of endpoints. Six bespoke workflows would be six places to get authorisation wrong |
| D2 | Approval types | `PURCHASE_ORDER`, `TRANSFER_REQUEST`, `STOCK_WRITE_OFF`, `PRICE_CHANGE`, `CREDIT_LIMIT_CHANGE`, `SHIFT_VARIANCE`, `REFUND` | Operator decision on the queue's contents. `REFUND` is created by Phase 13 for refunds at or above `pos.refundApprovalThresholdMinor`, retrospectively when the refund was authorised offline |
| D3 | Self-approval | Blocked for every type. The decider must differ from the requester. Where that leaves no eligible approver (a manager requesting from their own branch), the admin decides | OWASP A01: separation of duties enforced in the service, not by hiding a button |
| D4 | Transfer lifecycle | Extend `transfer_status` with `REQUESTED`, `APPROVED`, `REJECTED`. A request is raised by the destination branch; **branch→branch** is approved by the source branch manager, **warehouse→branch** by the admin. `DRAFT` stays for admin-initiated direct transfers | Operator decision. Preserves the existing dispatch/receive/short-close path exactly |
| D5 | Transfer guards | Dispatch requires `APPROVED`; a rejected or cancelled request posts no movement; the requester cannot approve their own request; a request for an inactive branch or archived product is refused at creation | Fail closed |
| D6 | Write-offs | `stock_write_off` + lines with reason codes `DAMAGE`, `EXPIRY`, `OBSOLESCENCE`, `THEFT`, `SUPPLIER_FAULT`, `OTHER`. `THEFT` and `OTHER` require a note. Approval posts a negative movement; rejection changes nothing | Damaged and missing stock is a real, currently unrepresentable event. Reason codes make shrinkage analysable |
| D7 | Price band | `pricing.managerBandPercent`, default **10**, global, admin-only. Inside the band a manager's change applies immediately and is audited; outside, a `PRICE_CHANGE` request stores the current price and the proposed price, and applies exactly once on approval | Operator decision. Compared against the current effective **branch** price, not the base price |
| D8 | Credit limit changes | A manager proposes `newLimitMinor` and a reason; `credit_profile.limitMinor` changes only on approval; `before`/`after` stored on the approval | Credit is money. The current API lets a manager edit the limit directly (`credit.profile.manage`), which this closes for increases beyond the requester's own authority |
| D9 | Shift variance review | New setting `pos.shiftVarianceToleranceMinor`, default **2_000** pesewas (GHS 20). A close above tolerance sets the shift `REVIEW_REQUIRED`; a reviewer records an outcome note and the shift becomes `REVIEWED`. Shift figures remain immutable | Phase 6 already stores both client and server expected cash; this adds the human decision, not new arithmetic |
| D10 | Manager operations view | A branch-scoped page: pending approvals, transfer requests, write-offs, shift variances awaiting review, low stock, and customers over their limit. Counts link to the filtered list | The manager's daily starting point; reuses Phase 9 read models where they already answer the question |
| D11 | Notification | In-app only: a badge on the Approvals nav item plus the queue itself, ordered oldest first with age and value. No email, no SMS | Operator decision. The existing email adapter is not on the critical path |
| D12 | Immutability | A decided approval cannot be re-decided; a correction is a new request. Every decision writes an audit row with actor, reason, and before/after | Audit integrity |
| D13 | Offline | None of this runs on the POS. A pending approval never blocks a sale; the POS conflict and override paths are unchanged | AGENTS.md: never block a sale at the till |
| D14 | Verification | Unit tests for authority resolution, self-approval block, band arithmetic, tolerance boundary; API walkthrough per type (request → approve → effect; request → reject → no effect); reconciliation after write-offs and transfer requests; console walkthrough with screenshots; existing suites unchanged | Goal-backward |
| D15 | Cycle count scheduling | New `count_schedule` table: scope (`CATEGORY`, `BRAND`, `ABC_CLASS`, `ROTATION`), scopeId, branchId, frequency (`WEEKLY`, `MONTHLY`, `QUARTERLY`, `BIANNUAL`), `nextDueAt`, `isActive`. A scheduled job in pg-boss generates a `stock_count` draft for the scope when due, with `dueAt` and `assignedTo`, and advances `nextDueAt`. The existing count snapshot/entry/post path is used unchanged | Operator decision. A count that has to be remembered is a count that does not happen; the posting logic already works |
| D16 | Counting cadence | ABC classes are derived from value and movement (`A` = top ~20% of SKUs by value, `B` the next 30%, `C` the rest) and are editable by the admin. Default schedule: A monthly, B quarterly, C biannual. A rotation schedule guarantees every active SKU is counted at least once per period | Standard parts-inventory practice: count what the money is in, most often |
| D17 | Trigger counts | A posted count whose absolute variance value exceeds `inventory.countVarianceToleranceMinor` (default 1,000 pesewas), or a product with two oversell conflicts in 30 days, raises a single open trigger count for that product, de-duplicated while one is open | Catches drift where it actually starts, without flooding the branch with work |
| D18 | Accuracy metric | `inventory accuracy = matched counted lines / total counted lines`, per branch and period, plus counts completed on time and total variance value. Displayed on the manager operations view and in analytics | This is the number that says whether the stock figure is trustworthy |

## Invariants

- A decision names a person; an effect without an approval row is a defect.
- No self-approval, no exceptions in code.
- Rejection leaves the world exactly as it was.
- Stock, credit, and price effects are applied once and audited.
- The POS never waits for an approval.

## Planned Plans

1. Schema, settings, permissions, approval extensions.
2. Transfer request lifecycle and authority.
3. Stock write-off workflow.
4. Price band and price change requests.
5. Credit limit change requests.
6. Shift variance review.
7. Cycle count schedules, ABC classification, trigger counts, accuracy metric.
8. Unified approval inbox (API + console) and manager operations view.
9. Verification, evidence, state update.
