# 19-05 — Reports, movement filter and the live-branch runbook

**Goal:** after the opening, the numbers can be read back and the operator knows exactly
what to do on the day.

**Must be true when done**

- `OPENING` appears in the movement filter and the stock report's by-type rows with no
  hand-edited list.
- The opening detail returns the counted value, the posted value, the uncosted line count and
  the new-product count; the list can be filtered by status and branch.
- A reconcile check proves `Σ quantity_delta = stock_level.quantity_on_hand` for the branch
  after the post (the existing `reconcileBranch` is re-run in the verification).
- A runbook exists at `.planning/phases/19-go-live-onboarding/RUNBOOK.md` and covers: freeze,
  count, backup, export, template, preview, review, post, terminal sync, oversell-conflict
  review, sign-off, corrections, VAT/cost note, and what is not migrated.

## Tasks

1. Confirm `movementListQuerySchema` and `inventory.report.ts` include the new enum value;
   add a test that filters `type=OPENING`.
2. Add the opening totals to the list/detail responses and the console list columns.
3. Write the runbook with the operator's actual sequence and the "do not use a receipt"
   warning.
4. Note the accounting treatment and the Ghana pre-registration VAT caveat.
5. Update `AGENTS.md`'s current-status paragraph and `.planning/PROJECT.md`'s scope line
   (bulk onboarding is now in scope) in the controller's commit.

## Verification

Stock report `?from=…&to=…` shows the opening inflow; the movement filter returns only the
opening rows; the runbook is linked from the phase README.
