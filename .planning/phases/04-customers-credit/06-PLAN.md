---
phase: 04-customers-credit
plan: 06
wave: 5
title: Console — customers, credit ledger, repayments, statements, aging
requirements: [CUS-01..06, ADM-05]
depends_on: [02, 03]
status: planned
created: 2026-10-18
---

# Plan 06 — Console Customers & Credit

**Goal:** The whole credit story is operable from the console: find or create a customer,
see and manage their branch credit entitlements, read the ledger, record repayments and
adjustments (with over-limit override), and print statements and aging that match the
server numbers.

## Task 1 — Sidebar, customers list, search, and create

**Files:** `admin/src/components/layout/sidebar.tsx`,
`admin/src/routes/_authenticated/customers/route.tsx`,
`admin/src/routes/_authenticated/customers/index.tsx`,
`admin/src/components/customers/customer-form-dialog.tsx`,
`admin/src/lib/api.ts`, `admin/src/lib/api-types.ts`

- Sidebar: “Customers” entry (icon `Users`) gated by `customer.read`; layout route with
  tabs Customers | Aging (Aging tab arrives in Task 4 of this plan’s file set).
- List page: debounced search field (phone digits or name; hint “Search by phone or
  name”), archived toggle (admin only), pagination; columns: name, phone (formatted via
  `formatGhanaPhone`), email, created at, status badge; row → detail. Query key
  `['customers', query]`.
- Create dialog: name, phone (required, input hint for `024…` or `+233…`), email,
  address; native form validation + server 400/409 surfacing (duplicate phone shows the
  existing customer link); invalidate the list on success.
- API helpers in `admin/src/lib/api.ts` following the existing fetch wrapper; types in
  `api-types.ts`.

**Verify:** create a customer from the console, search by last four digits and by name
fragment, open the detail page; duplicate phone shows the conflict; cashier-less
manager/admin permission gates match API behavior.
**Commit:** `feat(admin): add customers list, search, and create`

## Task 2 — Customer profile, credit panels, and ledger

**Files:** `admin/src/routes/_authenticated/customers/$id.tsx`,
`admin/src/components/customers/credit-profile-dialog.tsx`,
`admin/src/components/customers/credit-ledger-table.tsx`,
`admin/src/lib/api.ts`, `admin/src/lib/api-types.ts`

- Profile page: header with name/phone/email/address + edit dialog (`customer.update`);
  tabs or cards: Overview (identity + loyalty summary placeholder consumed in Plan 07),
  Credit, Ledger.
- Credit card per branch (manager: own branch only; admin: branch selector + list of all
  profiles): limit, hold badge, payment terms, notes, current balance (state “customer
  credit” when negative), buttons: “Credit settings” (`credit.profile.manage`) opening
  the profile dialog (limit in GHS → pesewas, terms days, hold toggle, notes).
- Ledger table: date range + kind filter, columns date, kind badge, reference, due date,
  amount (signed, GHS), balance, note; pagination; reconciles visually with the header
  balance. Query keys `['credit-profile', customerId, branchId]`,
  `['credit-entries', customerId, branchId, filters]`.

**Verify:** set a limit and terms as manager; create entries via API and watch the
ledger and balance render; manager never sees another branch’s panel; admin switches
branches.
**Commit:** `feat(admin): add customer profile and credit ledger panel`

## Task 3 — Repayments, adjustments, and over-limit override dialogs

**Files:** `admin/src/components/customers/repayment-dialog.tsx`,
`admin/src/components/customers/credit-entry-dialog.tsx`,
`admin/src/routes/_authenticated/customers/$id.tsx`,
`admin/src/lib/api.ts`, `admin/src/lib/api-types.ts`

- Repayment dialog (`credit.repayment`): amount (GHS), method (Cash/MoMo/Bank),
  reference (optional; required for MoMo/Bank), received-by (defaults to the signed-in
  user), note; success toast shows the allocated `REP-…` number; negative-balance
  hint when the repayment would leave credit.
- Entry dialog (`credit.adjust`): kind selector Charge / Refund / Adjustment; amount
  GHS; reason select per kind (opening balance, correction, write-off, dispute, other);
  note; when a server 409 reports the over-limit state, reveal the override section
  (reason code select + note) only for `credit.override` holders — resubmit sends the
  override.
- All mutations invalidate balance + ledger + aging queries.

**Verify:** record a repayment → toast with REP number, balance drops; over-limit charge
shows the override section for the manager, is blocked without it, succeeds with it
(audit visible in Settings → Audit); refund reduces the balance.
**Commit:** `feat(admin): add repayment and credit entry dialogs with override`

## Task 4 — Statement, aging, and lifecycle actions

**Files:** `admin/src/routes/_authenticated/customers/$id.statement.tsx`,
`admin/src/routes/_authenticated/customers/aging.tsx`,
`admin/src/components/customers/statement-view.tsx`,
`admin/src/components/customers/aging-table.tsx`,
`admin/src/components/customers/customer-lifecycle-dialogs.tsx`,
`admin/src/lib/api.ts`, `admin/src/lib/api-types.ts`

- Statement page: branch + date range selectors (printed via `window.print()`; print CSS
  hides chrome, A4 margins); header (business, customer, branch, range), opening
  balance, entries, closing balance, aging summary — exactly the API statement payload.
- Aging tab: branch select (manager fixed), as-of date, bucket columns
  (Current / 1–30 / 31–60 / 61–90 / 90+) with customer rows and totals; zero values
  muted; print-friendly too.
- Lifecycle (admin): archive dialog (note), reactivate action, anonymize dialog that
  states the zero-balance rule and shows the 409 blockers readably; success returns to
  the list and the customer disappears from default search (phone reusable).
- Sidebar/tab wiring for Aging; route permission gates.

**Verify:** print preview shows a clean A4 statement matching the ledger numbers; aging
buckets change when terms/date fixtures change; archive blocks new charges (409 surfaced
in the entry dialog); anonymize blocked by a balance then succeeds at zero and the
record shows “Anonymized customer” with intact ledger.
**Commit:** `feat(admin): add credit statement, aging, and customer lifecycle actions`

## Done When

Every CUS-01…06 workflow is operable from the console with server-accurate numbers:
search/create, entitlements, ledger, repayments with references, adjustments with
override, printable statement and aging, and DPA lifecycle actions — all permission
gated and branch scoped.
