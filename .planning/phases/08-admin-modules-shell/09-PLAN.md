---
phase: 08-admin-modules-shell
plan: 09
wave: 9
title: Customers module — the composition root
requirements: [UIX-06]
depends_on: [08]
status: planned
created: 2026-10-24
---

# Plan 09 — `modules/customers`

**Goal:** The customer profile is where the module boundary pays for itself: today a 470-line
route holds the customer, their credit, and their loyalty in one body. After this plan it
composes three barrels, and `components/customers/` no longer exists.

## Task 1 — API, keys, types

**Files:** new `admin/src/modules/customers/{api,types,utils}`; `lib/api.ts`; `lib/api-types.ts`

- `api/keys.ts`: `customerKeys` with `customers`, `customer`, `customer-search` — the measured
  roots — plus the invalidation note: a credit or loyalty mutation on the profile must still
  refresh the customer query, so the page invalidates `customerKeys.byId(id)` explicitly rather
  than relying on a shared prefix.
- `api/customers.ts` takes the `api.customers` group verbatim (lines 270–299 of `lib/api.ts`).
- `types/`: `CustomerStatus`, `CustomerListRow`, `CustomerCreditProfileRow`, `CustomerDetail`,
  `CustomerSearchResult`, `CustomerCreateInput`, `CustomerUpdateInput`, `CustomerListQuery`.
  `CustomerLoyaltySummary` moved to `modules/loyalty` in Plan 08 — import it from there.
- `utils/`: the phone display/search helpers already live in `@sceptre/shared`
  (`normalizeGhanaPhone`, `formatGhanaPhone`); if the page holds any customer-specific derived
  value, it moves to `utils/` as a pure function. **No PII goes into a log line or a query key**
  — the search term is the exception and already is one.

**Verify:** `grep -rn "api.customers" admin/src` returns nothing; customer search still works by
phone suffix and by name.

**Commit:** `refactor(admin): add the customers module api and types`

## Task 2 — The list and the forms

**Files:** `modules/customers/pages/{customers-page,customer-detail-page}.tsx`,
`modules/customers/components/{customer-table,customer-form-dialog,customer-lifecycle-dialogs}.tsx`,
`routes/_authenticated/customers/{route,index,$id}.tsx`,
`routes/_authenticated/customers/$id/index.tsx`, `index.ts`

- `pages/customers-page.tsx` from `customers/index.tsx` (168 lines): search, pagination, archived
  toggle (admin only), create.
- `components/customer-form-dialog` and `customer-lifecycle-dialogs` move from
  `components/customers/` — archive, reactivate, anonymize. Anonymize keeps its confirmation and
  its server guard (zero credit balance, zero points).
- `customers/route.tsx` (47 lines) becomes `pages/customers-layout.tsx` (Plan 05's pattern); the
  pass-through `customers/$id.tsx` stays a bare `<Outlet />`.
- `pages/customer-detail-page.tsx` is the 470-line body, now composing three modules:
  - own: `customer-form-dialog`, `customer-lifecycle-dialogs`, the profile header;
  - `#/modules/credit`: `CreditProfileDialog`, `CreditEntryDialog`, `CreditLedgerTable`,
    `RepaymentDialog`;
  - `#/modules/loyalty`: `LoyaltyCard`.
  Split the tab bodies into `components/customer-{profile,credit,loyalty}-tab.tsx` **only if the
  split is mechanical** (each tab is already a contiguous block); otherwise move the body whole
  and leave refactoring to a later phase. Do not restructure the JSX.
- Preserve exactly: branch-scoped credit panels (an admin must pick a branch before a profile is
  editable), the loyalty balance card, and every `can(…)` gate.

**Verify:** create a customer, edit, archive, reactivate, anonymize (with its guards); search by
phone at another branch's context still finds the global identity while the credit panel shows
the **active** branch's limit; the loyalty tab renders; the credit ledger and repayment dialogs
open from the profile. `bun run modules:check` passes with eleven modules migrated.

**Commit:** `refactor(admin): move customers into the customers module and compose credit and loyalty`

## Task 3 — Delete the old folder and close the boundary

**Files:** `admin/src/components/customers/` (deleted), `scripts/check-modules.mjs`
(**controller-owned**), `admin/biome.json`

- `components/customers/` must be empty by now (credit and loyalty moved in Plans 07/08). Delete
  it and add `#/components/customers/**` to the legacy group.
- Remove `customers` from `PENDING_MODULES`.

**Verify:** `grep -rn "#/components/customers" admin/src` returns nothing (including the Biome
override, which is not a source import); `bun run modules:check` passes; `bun run lint`,
`bun run check-types`, `bun run --filter admin build` green; root `bun run test` unchanged;
append to `evidence/suites.txt`.

**Commit:** `chore(admin): record customers as migrated and retire the shared folder`

## Definition of Done

- The **first three-module composition** works through barrels only, with no `components/`
  shorthand left.
- `components/customers/` is gone; credit and loyalty are reachable only through their barrels.
- Customer identity, branch-local credit, and global loyalty still behave exactly as before.
- No PII, phone number, or account figure appears in a log line or a query key beyond the search
  term the API already accepts.
