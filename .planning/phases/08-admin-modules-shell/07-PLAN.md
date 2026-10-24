---
phase: 08-admin-modules-shell
plan: 07
wave: 7
title: Credit module — ledger, repayments, aging, statements
requirements: [UIX-06]
depends_on: [06]
status: planned
created: 2026-10-24
---

# Plan 07 — `modules/credit`

**Goal:** Credit becomes its own module before `customers` migrates, because the customer detail
page is the composition root for credit and loyalty (`01-RESEARCH.md` §7). After this plan the
customer profile imports a credit **barrel** instead of a sibling folder.

Routes here live under `/customers/…` but belong to `credit` (research F8): `customers/aging.tsx`
is the credit aging report and `customers/$id.statement.tsx` is a credit statement.

## Task 1 — API, keys, types, utils

**Files:** new `admin/src/modules/credit/{api,types,utils}`; `lib/api.ts`; `lib/api-types.ts`;
`admin/src/lib/credit.ts` (moved to `modules/credit/utils/credit.ts`)

- `api/keys.ts`: `creditKeys` with the measured roots `credit-profiles`, `credit-entries`,
  `credit-statement`, `credit-aging` — spelled exactly as today.
- `api/credit.ts` takes the `api.credit` group verbatim (lines 300–327 of `lib/api.ts`).
- `types/`: `CreditProfile`, `CreditProfileRow`/`CreditProfileListRow`, `CreditEntry`,
  `CreditEntryKind`, `CreditMethod`, `CreditReasonCode`, `CreditOverrideReason`,
  `CreditEntryCreateInput`, `CreditEntryListQuery`, `CreditEntryListResult`,
  `CreditPostingResult`, `CreditProfileUpdateInput`, `CreditStatement`, `AgingBucketKey`,
  `AgingQuery`, `AgingResult`.
- `utils/credit.ts` is the existing `lib/credit.ts` moved whole — the label/tone maps and the
  pure helpers (`settleCharges` mirrors live server-side; do not port logic). It imports
  `#/lib/format`, which is allowed.
- `lib/credit.ts` is deleted and its importers updated (measured: the customer detail route and
  the aging table).

**Verify:** `grep -rn "lib/credit" admin/src` returns nothing; `bun run check-types` green.

**Commit:** `refactor(admin): add the credit module api, types, and utils`

## Task 2 — Components

**Files:** `admin/src/modules/credit/components/{credit-ledger-table,credit-profile-dialog,credit-entry-dialog,repayment-dialog,aging-table,statement-view}.tsx` (moved from
`admin/src/components/customers/`); `admin/src/routes/_authenticated/customers/$id/index.tsx`
(import specifiers only)

- Move the six files verbatim. `credit-ledger-table` and `repayment-dialog` are consumed by the
  customer detail page, so that route's imports flip to `#/modules/credit` — **imports only**;
  the file's body is Plan 09's job.
- `statement-view` is the printable A4 statement. It must keep using the shared date helpers
  (`formatDay`, `formatDayShort` from `@sceptre/shared`) and the print rules from Phase 7 — a
  statement printed from dark mode must still print light.
- Preserve: over-limit override capture (reason + approver), repayment method requirement, the
  hold state, and every `can("credit.…")` gate.

**Verify:** the ledger table, profile dialog, charge/repayment dialogs, aging table, and
statement view render from their new home; printing a statement from dark mode is still light.

**Commit:** `refactor(admin): move the credit components into the credit module`

## Task 3 — Pages

**Files:** `admin/src/modules/credit/pages/{credit-aging-page,credit-statement-page}.tsx`;
`routes/_authenticated/customers/aging.tsx`;
`routes/_authenticated/customers/$id.statement.tsx`; `index.ts`

- `credit-aging-page` from `customers/aging.tsx` (117 lines): period and branch filters, the
  five buckets, per-customer rows and branch totals. It reads `activeBranchId` from the branch
  context and, for an admin, **must** name a branch — keep the current guard.
- `credit-statement-page` from `customers/$id.statement.tsx` (150 lines): `from`/`to` inputs,
  opening/ranged/closing figures, aging snapshot, print button.
- Both routes become `createFileRoute(...)({ component: …Page })` with their `validateSearch`
  (if any) left on the route.
- Keep the `settleCharges` ordering visible in the UI: oldest charge first.

**Verify:** the aging report reconciles with the credit ledger for the demo customer (opening +
entries = closing; buckets match); a manager cannot obtain another branch's aging by editing the
URL; the statement prints with the same columns.

**Commit:** `refactor(admin): move the credit aging and statement pages into the credit module`

## Task 4 — Clear the name

**Files:** `scripts/check-modules.mjs` (**controller-owned**), `admin/biome.json`

- Remove `credit` from `PENDING_MODULES`. Do **not** yet add `#/components/customers/**` to the
  legacy group — `components/customers/` still holds the customer and loyalty files until Plans
  08 and 09.

**Verify:** `bun run modules:check` passes with nine modules migrated; root `bun run test`
unchanged; append to `evidence/suites.txt`.

**Commit:** `chore(admin): record credit as migrated`

## Definition of Done

- Credit owns its API, keys, types, utils, six components, and two pages, with one barrel.
- The customer detail route compiles against `#/modules/credit` and its body is untouched.
- Money is still integer minor units everywhere; no new arithmetic was added to a moved file.
- Aging, statement, ledger, repayment, and override behaviour are identical.
