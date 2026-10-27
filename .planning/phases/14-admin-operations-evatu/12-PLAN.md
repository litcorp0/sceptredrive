---
phase: 14-admin-operations-evatu
plan: 12
title: Desktop — the Z itemises cash refunds, and a manager may close a drawer
lane: desktop
depends_on: [01, 03]
requirements: [POS-13, BRN-04]   # inherited: the Phase 13 Z defect and the Phase 12 close gap
---

# Plan 12 — Two defects on the paper and at the drawer

## Goal

The printed Z shows the cash refund it subtracts, so the drawer arithmetic on paper adds
up. And a manager or admin signed in at the terminal can close a shift another cashier
opened, with their own identity recorded — which is what the server has allowed since
Phase 13 and the till has not.

## Read first

- `00-DECISIONS.md` P14-D1, D12.
- `01-RESEARCH.md` facts 58–63.
- `desktop/src/renderer/lib/receipt/report-render.ts:24-68` (`ShiftReportFigures`),
  `:160-215` (the DRAWER block), `:105-128` (`reportToPrintLines` roles).
- `desktop/src/renderer/lib/shift/shift-service.ts` — `closeShift`, `openShiftOrThrow`.
- `desktop/src/renderer/lib/shift/shift-repository.ts` — the report read and its types.
- `desktop/src/renderer/modules/shift/utils/print-report.ts:27-56`,
  `modules/shift/pages/shift-page.tsx` and the close dialog.
- `api/src/modules/pos/pos.service.ts:630-701` (`closeShift`), `:932-991` (`getZReport`) —
  where `closedBy` is honoured and the review is raised.
- `api/src/modules/pos/pos.service.ts` (Plan 03's `cashRefundMinor`) and
  `pos.schema.ts:624-679`.
- `desktop/src/renderer/lib/receipt/render.test.ts:196-320` — the document test style.

## Tasks

### 1. The figure arrives

`ShiftReportFigures` gains `cashRefundMinor: number | null`. `report-render.ts`'s builder
takes it from the report payload; nothing computes it locally, and the desktop does not sum
`refund_tender` — the server already does, and two summations would eventually disagree.

### 2. The DRAWER block becomes arithmetic

Replace the six-line block with the same six lines plus the two that were missing, in the
order the money moved:

```text
DRAWER
  Opening float        GHS  1 000.00
  Cash taken           GHS  4 300.00
  Change given         GHS   -200.00
  Cash refunds         GHS   -500.00
  Cash in              GHS    200.00
  Cash out             GHS    -100.00
  Expected             GHS  4 700.00
  Counted              GHS  4 700.00
  Variance             GHS      0.00
```

`Cash taken`, `Change given` and `Cash refunds` already exist as fields (`cashMinor`,
`changeMinor`, the new `cashRefundMinor`). A null `cashRefundMinor` prints
`Cash refunds  not itemised` — a sentence, not a zero, because zero is an assertion the
snapshot cannot support (P14-D1, research fact 16).

The TENDERS block keeps `Cash` as the gross tender figure; `Cash taken` in DRAWER is the
same number and the two are deliberately the same number. A manager comparing the two
should find them equal, and a test asserts it.

### 3. The screen says the same

`modules/shift/`'s report view (the on-screen Z/X) uses the same builder, so it inherits
the lines. If the screen renders the drawer block from its own JSX rather than the builder,
it changes to render the builder's lines — one document, two surfaces, as Phase 13 already
required.

### 4. A manager may close a drawer they did not open

`closeShift` currently calls `openShiftOrThrow`, which throws `NOT_OWNER` unless the signed-in
staff member is the shift's cashier. Replace it with `resolveShiftForClose(shiftId)`:

- load the open shift for the terminal;
- the caller may close if **either** they are the shift's cashier **or** their role is
  `MANAGER` or `ADMIN` and the shift belongs to their branch (the terminal is in the
  branch, so branch equality is the check);
- anything else is `NOT_OWNER`, unchanged.

Everything after the guard is untouched: the count, the variance, the Z, the outbox row.
The payload's `closedBy` is the signed-in staff member either way, so the server records
"closed by the manager" and raises the variance review with the manager as requester
(Phase 13's D41) — which is also what closes the Phase 12 self-review hole for this case.

The close dialog gains one sentence when the closer is not the shift's cashier: *"You are
closing Ama Mensah's drawer. The variance review will name you as the requester."*

### 5. Tests

`lib/receipt/report-render.test.ts`:
- a full document with `cashRefundMinor = 50000` prints `Cash refunds` with `-500.00` and
  the expected figure equals the printed arithmetic;
- `cashRefundMinor = null` prints `not itemised` and no minus sign;
- `Cash taken` in DRAWER equals `Cash` in TENDERS;
- the line count and the 42-column width hold (the existing assertions still pass).

`lib/shift/shift-service.test.ts`:
- a cashier closes their own shift (existing, unchanged);
- a **manager** closes a cashier's shift: the outbox payload's `closedBy` is the manager,
  the count is the manager's, and the Z is written;
- a cashier closing another cashier's shift is `NOT_OWNER`;
- a manager of another branch cannot reach the terminal's shift (the terminal lookup already
  scopes it; assert the error rather than assuming).

`modules/shift/utils/print-report.test.ts`: the job carries the new figures and still does
not open the drawer.

### 6. What this plan does not do

No new ESC/POS capability, no QR, no change to the close arithmetic. The expected-cash
formula was fixed in Phase 13 and is not touched — the plan prints what it already does.

## Verification

```bash
bun run --filter @sceptre/desktop test     # 593 → ~605
bun run check-types
bun run test:counter                        # by hand: the packaged print section
```

Then close a shift with a cash refund in the dev build and read the paper: the three
deductions must sum to the difference between `Opening float + Cash taken + Cash in` and
`Expected`.

## Commits

1. `feat(desktop): the Z names the cash refund it subtracts`
2. `feat(desktop): a manager may close a cashier's drawer, as themselves`
3. `test(desktop): the drawer arithmetic on paper and the close authority`

## Done when

- A drawer that refunded GH₵500 closes with a Z whose lines add up without a calculator.
- A manager can take over a drawer at shift end, and the review that follows names the
  manager rather than the cashier.
