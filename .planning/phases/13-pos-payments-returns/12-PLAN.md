---
phase: 13-pos-payments-returns
plan: 12
title: Console — the refund approval detail
lane: admin
depends_on: [05]
requirements: [POS-10, APR-01, APR-02, APR-03]
---

# Plan 12 — Head office can see what it is being asked to accept

## Goal

A `REFUND` approval appears in the unified inbox with a detail view that shows the receipt, the lines,
the goods' fate, the tenders and the manager who authorised it. Approving or rejecting changes no
money — it records a decision on a refund that already happened, which is the whole point of a
retrospective approval.

## Read first

- `00-DECISIONS.md` P13-D21, P13-D23, P13-D24.
- `admin/src/modules/approvals/` — `pages/approval-detail-page.tsx`, `components/*-panel.tsx` for the
  six existing subjects, `utils/approval.ts` (labels), `types/`.
- `api/src/modules/approvals/approvals.types.ts` — the `refund` arm Plan 05 added.
- `admin/src/modules/operations/` — the manager view that already counts approvals; it needs no change
  and a test proves it.
- `.planning/phases/12-branch-ops-approvals/evidence/walkthrough-console.mjs` — the walkthrough style
  Plan 13 extends.

## Tasks

### 1. The subject

`admin/src/modules/approvals/types/` gains `ApprovalSubject`'s `refund` arm, mirroring the API exactly
(no widening, no optional fields the server does not send).

### 2. The detail panel

`components/refund-subject-panel.tsx`:

- **Header**: refund number, original receipt number, the branch and terminal, `occurredAt`
  (`formatDateTime`), and the refunded total as the headline figure.
- **Lines**: product, quantity, unit price, line total, and a restock badge —
  `Back to stock` / `Damaged — <reason>` / `Kept by customer`. The badge text comes from
  `REFUND_RESTOCK_LABELS` in `@sceptre/shared`, so the console and the till cannot disagree.
- **Tenders**: method label, amount, status (`Settled` / `Back to the card` / `Failed` /
  `Needs attention`) — the reviewer needs to know whether the customer actually got the money.
- **Why**: the reason label from `REFUND_REASON_LABELS`, plus the note in full.
- **Who**: the approving manager's staff label, and the cashier who took it. Self-approval is already
  impossible for an `ADMIN`-authority row, but the two names make the trail readable.
- **Nothing else.** No price edit, no re-run, no "retry refund" button: those are Phase 14's
  oversight tools, and a decision screen that can move money is not a decision screen.

### 3. Decision

The existing decide form is reused (`approval.decide`, a reason code and note on rejection). For
`REFUND` the reject path is legitimate — head office can refuse to accept the refund — so no special
case is added and no note is required to approve.

The panel's copy under the buttons states the truth: *"This refund has already been given. Your
decision is recorded against it and changes no money."*

### 4. Inbox and badges

`utils/approval.ts` already labels `REFUND`; the type filter, the summary counts and the operations
card are generic over `APPROVAL_TYPES`, so the only work is proving they include it. Add one assertion
to the module's existing type test that `REFUND` renders a label and a filter pill.

### 5. Tests and gates

- `bun run --filter admin test` (if the module has unit tests; if not, the type check is the gate).
- `bun run --filter admin build`.
- `bun run modules:check:strict` — the module list must not change (no new module).
- The browser walkthrough is Plan 13's: it drives a real refund (mock provider), opens the inbox,
  asserts the detail shows the receipt, the restock badges and the tenders, approves it, and asserts
  the refund's money columns are unchanged by re-reading the API.

## Verification

```bash
bun run --filter admin check-types
bun run --filter admin build
bun run modules:check:strict
bun run lint
```

Expected: no change to the API or desktop counts. Brand gate over the tracked file count (1 035 + this
phase's files).

## Commits

1. `feat(admin): the refund approval detail`
2. `test(admin): the refund type renders in the inbox and the filters`

## Done when

- A GH₵250 refund that happened at 09:14 is legible at 10:00 without asking the branch.
- The reviewer can see whether the customer has actually been paid.
- Nothing on the screen can move a pesewa.
