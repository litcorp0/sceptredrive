---
phase: 14-admin-operations-evatu
plan: 03
title: Oversight reads — sales, refunds, shifts, the receipt copy, cart voids
lane: api
depends_on: [02]
requirements: [ADM-07]
---

# Plan 03 — The documents a manager needs at 10:00

## Goal

A session — not a device — can read the sale that took GH₵1 300, the refund that reversed
GH₵250 of it, the shift that contains both, the voids in that shift, and a receipt copy
that reconciles to the sale to the pesewa. Read-only, branch-scoped, PII-masked, and every
figure taken from the row that owns it.

## Read first

- `00-DECISIONS.md` P14-D3, D10, D11, D12, D16.
- `01-RESEARCH.md` facts 9–25, 29, 58–60.
- `api/src/modules/pos/pos.routes.ts` (15 lines), `pos.controller.ts`, `pos.validation.ts`.
- `api/src/modules/pos/pos.repository.ts:609-664` — `findSaleByReceiptNumber`,
  `findSaleById`, `selectSaleLinesForRefund`, `selectSaleTendersForRefund`;
  `:242`, `:288`, `:389-422`, `:1118-1229` — the shift reads.
- `api/src/modules/pos/pos.service.ts:932-1044` — `getZReport` and `getXReport` and the
  device-ownership guard at `:914-922`.
- `api/src/modules/pos/pos.schema.ts:142-272`, `:452-617`, `:624-679`.
- `api/src/modules/analytics/analytics.repository.ts:502-574` — the existing sale row
  shape; the oversight row is deliberately a different shape (it carries an id).
- `api/src/http/scope.ts:34-45` — `resolveBranchFilter`.

## Tasks

### 1. Two new files, not a bigger service

`pos.oversight.repository.ts` (Drizzle only) and `pos.oversight.service.ts` (scope,
authorisation, assembly). `pos.service.ts` is 3 128 lines; oversight is a read model and
does not belong in it. The one exception is Task 5, where an *existing* function is
extracted rather than duplicated.

### 2. Routes — `pos.routes.ts`

All under `requireSession` + `requirePermission('pos.oversight.read')`, plus a 120/min
per-user rate limit, following `analytics.routes.ts:18-23`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/pos/oversight/sales` | paged, filtered list |
| GET | `/api/pos/oversight/sales/:id` | header + lines + tenders + refunds + conflicts |
| GET | `/api/pos/oversight/sales/:id/receipt` | the receipt copy |
| GET | `/api/pos/oversight/refunds` | paged, filtered list |
| GET | `/api/pos/oversight/refunds/:id` | lines, tenders, approval link |
| GET | `/api/pos/oversight/shifts` | paged, filtered list |
| GET | `/api/pos/oversight/shifts/:id` | shift + Z (stored) or X (live) + voids |
| GET | `/api/pos/oversight/shifts/:id/report?kind=X\|Z` | the report document, session-gated |

`pos.validation.ts` gains Zod `.strict()` schemas: `branchId`, `from`, `to`,
`terminalId`, `cashierStaffId`, `receiptNumber` (exact, trimmed), `limit` 1–50 default 20,
`offset` ≥ 0. Refunds add `method`, `tenderStatus`, `reasonCode`. Shifts add `status` and
`reviewStatus`. Dates go through `accraDayBounds`; an admin with no `branchId` gets all
branches, a manager is forced to theirs and a foreign id is a **403** via
`resolveBranchFilter`.

### 3. The sale row and the sale detail

The list row carries **an id** (the analytics row does not, which is why it cannot link):
`id, receiptNumber, occurredAt, branchCode, branchName, terminalCode, cashierName,
customerName, itemsSold, totalMinor, taxTotalMinor, changeMinor, creditMinor,
conflictCount, refundedMinor`.

`refundedMinor` is `Σ refund.refunded_minor` for the sale, computed by a correlated
sub-select in the same statement — a list that shows a fully refunded sale as a sale is a
list a manager will trust wrongly.

The detail adds lines (all `sale_line` columns a receipt needs, ordered by `line_number`),
tenders ordered by `sequence`, `refunds: [{ id, number, refundedMinor, occurredAt }]`,
and `conflicts: [{ id, type, severity, status }]` (ids only — Plan 04 owns the queue).

### 4. The receipt copy

`GET /api/pos/oversight/sales/:id/receipt` returns a document shaped like the desktop's
`ReceiptModel` (`desktop/.../receipt/render.ts:65-109`) but assembled from server rows:

- **header** — `seller` from `getSettingValue('receipt.header', { branchId: sale.branchId })`,
  `branchName`, `branchCode`, `terminalCode`, `receiptNumber`, `occurredAt`, `cashierName`,
  `customer: { name, phoneMasked } | null`, and `isCopy: true`, `reprint: false`;
- **lines** — the eight tax columns per line, exactly as `sale_line` stores them;
- **totals** — the sale's own columns, never re-added;
- **tenders** — `sale_tender` ordered by `sequence`, with the method and amount;
- **loyalty** — `loyaltyEarnedPoints`, `loyaltyRedeemPoints`, or null;
- **evat** — the certificate fields from `evat_submission` joined by `sale_id`, or null;
- **footer** — `getSettingValue('pos.receiptFooter')`.

The copy sets `isCopy: true` because it is not the till's paper. The console says so
(P14-D10) and the API makes it true rather than leaving it to copywriting.

`phoneMasked` is computed **server-side** (`••••` + last four) and the full number is never
in the payload. A client-side mask is a disclosure with extra steps.

### 5. Shifts: one arithmetic, two gates

Extract the body of `getZReport`/`getXReport` into
`readShiftReport(scope: { branchId: string }, shiftId, kind)` in `pos.service.ts`. The
existing device route becomes a caller that first proves the shift belongs to the calling
device's terminal and branch (`:914-922`, unchanged). The new session route becomes a
caller that proves `resolveBranchFilter` allows the shift's branch. Both call the same
function; there is no second expected-cash formula.

- `kind=Z` reads `shift_report` and **refuses to rebuild** when the snapshot is missing
  (`SHIFT_REPORT_MISSING`, 500 — Phase 13's leg 28 behaviour, preserved).
- `kind=X` computes live and writes nothing; asking for an X of a closed shift returns the
  live figures with `closedAt` set, which is a legitimate reading of a drawer.

The shift detail embeds the report and adds `voids: [{ count, grossMinor, reasonCode,
label, itemCount, occurredAt }]` from `cart_void` for that shift — the only read path
voids have ever had (research fact 20).

### 6. The Z snapshot records the refund it already subtracts

`selectShiftReportFigures` already subtracts settled `CASH` refund tenders from expected
cash (Phase 13's fix) but never returns the figure, and `shift_report` has no column for it.
Add `cashRefundMinor` to the figures selector, to `insertShiftReport` (so the snapshot
stores it at close, inside the same transaction), to the API's `ShiftReportFigures`, and to
the Z response. New rows carry it; a row written before this phase carries `null` and the
print says *not itemised* rather than inventing a figure (Plan 02's nullable column, Plan 12's
document).

### 7. Refund list and detail

List row: `id, number, occurredAt, branchCode, terminalCode, receiptNumber, cashierName,
refundedMinor, reasonCode, tenderCount, hasPendingTender, approvalId, approvedBy`.
Filters as in Task 2. Detail adds lines (with `restock`, `damageReason`) and tenders (with
`status`, `settledAt`, `providerRefundReference`, `failedMessage`) — the same fields the
approval subject shows, plus the ones a reviewer of a *closed* refund needs.

A refund at **any** amount is listed, not only one above the approval threshold. That is
the gap Phase 13 recorded: the console could see the refunds it was asked to review and
none of the ones it was not.

### 8. Tests — `pos.oversight.test.ts`

Fixtures through the real upload path (`sync.upload.test.ts:160-175`'s enrolment helper),
because a hand-inserted sale proves nothing about the shape the till sends.

- a cash sale list row carries an id and the same total as the sale row;
- `refundedMinor` is 0 before a refund and the refund total after one;
- a second-branch sale is absent from a manager's list, and `GET …/sales/:id` for it is a
  **403**, not a 404;
- `receiptNumber` filter is exact and case-sensitive; `from`/`to` are Accra days;
- the receipt copy's `Σ line.totalMinor === sale.totalMinor` and
  `Σ tender.amountMinor − changeMinor === totalMinor`, asserted on a three-tender sale;
- the copy's `customer.phone` is masked and the payload contains no full number
  (`JSON.stringify(payload)` does not contain the seeded phone);
- the copy's `evat` is null before Plan 07 and carries the certificate after (a fixture row
  inserted directly, since 07 does not exist yet);
- a manager requesting a Z of a shift in their branch gets the stored figures; deleting the
  `shift_report` row makes it `SHIFT_REPORT_MISSING`, never a rebuild;
- an X writes no row (`count(shift_report)` unchanged);
- a shift that refunded GH₵500 in cash stores `cash_refund_minor = 50000`, and
  `float + cash − change − cashRefund + in − out` equals `expected_cash_minor`;
- a shift_report row inserted with a null `cash_refund_minor` reads back `null` and the X
  does not fabricate one;
- the shift detail lists two voids with their reasons and their gross value;
- the refund list includes a below-threshold refund that has no approval;
- `REFUND_SALE_FOREIGN` — the API test Phase 13 owed: a device uploading a refund for a
  sale another terminal recorded is rejected with that code and writes no refund row.

## Verification

```bash
bun run --filter api test     # ~725 → ~760
bun run check-types
```

Reconciliation, by hand, on the demo dataset: pick one sale, sum its lines, its tenders and
the refunds against it in `psql`, and compare with the three API responses. They must agree
to the pesewa; if they do not, the read is composing instead of reading.

## Commits

1. `feat(api): oversight lists for sales, refunds and shifts behind one permission`
2. `feat(api): a receipt copy the server can prove, with the customer masked`
3. `refactor(api): one shift-report arithmetic with a device gate and a session gate`
4. `feat(api): cart voids are readable through the shift that contains them`
5. `feat(api): the Z snapshot stores the cash refund it was already subtracting`
6. `test(api): oversight scope, the receipt identity, the Z that refuses to rebuild`

## Done when

- A manager can answer "what happened on this receipt" without leaving the console.
- The receipt copy and the sale cannot disagree, because the copy is built from the sale's
  own columns.
- A closed shift's Z is the snapshot or an error — never a recomputation that looks
  authoritative.
