---
phase: 14-admin-operations-evatu
plan: 08
title: Console — the pos-oversight module and the receipt copy
lane: admin
depends_on: [03, 04]
requirements: [ADM-07]
---

# Plan 08 — Head office can see the document, not just the number

## Goal

The console has one section for what the terminals did: a filtered sales list, a sale
detail with its lines, its tenders and a printable receipt copy, a refund list that
includes the refunds nobody approved, a shift list that opens the stored Z, and a conflict
queue whose rows can be resolved with a code and a note. Nothing on any of these screens
moves a pesewa.

## Read first

- `00-DECISIONS.md` P14-D2 to D15.
- `01-RESEARCH.md` facts 49–57, 25.
- `admin/src/modules/README.md` — the layout, the seven folders, the barrel rule, the
  "a folder appears when it has content" rule.
- `scripts/check-modules.mjs:38-59`, `:98`, `:110-171` — the module list, the 25-line route,
  the one-barrel rule, the `*Page`/`*Layout` naming rule.
- `admin/src/modules/operations/` — the smallest complete module (5 files) and the shape
  this plan follows.
- `admin/src/modules/payables/pages/invoices-page.tsx` — the canonical list page: filters,
  table, `Pagination`, `TableMessage`, money from server integers.
- `admin/src/modules/approvals/pages/approval-detail-page.tsx` and
  `components/subject/refund-subject.tsx` — the detail-panel pattern and the only existing
  refund rendering.
- `admin/src/components/layout/sidebar.tsx:41-172`, `:241-250`.
- `admin/src/lib/api.ts:57-102`, `admin/src/lib/branch-context.tsx`, `admin/src/lib/role.ts`.
- `admin/src/modules/approvals/utils/approval.ts:232-259` — the search-schema style.
- `admin/test/walkthrough-sections.mjs:133-290` — the sections this plan adds.
- `admin/src/modules/dashboard/components/needs-attention.tsx:14`, `:61-71`.

## Tasks

### 1. The module and its gate entry

`admin/src/modules/pos-oversight/` with `api/`, `components/`, `pages/`, `types/`,
`utils/`, `index.ts`. No `ui/`, no `hooks/` unless a file actually belongs there — the
module README forbids empty folders.

Add `'pos-oversight'` to `REQUIRED_MODULES` in `scripts/check-modules.mjs`. That is a root
file: report `NEEDS_LANE_CHANGE` and let the controller make the one-line edit and commit
it before this plan's first commit lands.

### 2. Routes — five thin files

| Route file | Renders |
|---|---|
| `routes/_authenticated/pos/route.tsx` | `PosOversightLayout` (section heading + tab nav + `<Outlet />`) |
| `routes/_authenticated/pos/index.tsx` | `PosOversightPage` (the tab's list) |
| `routes/_authenticated/pos/sales/$saleId.tsx` | `SaleDetailPage` |
| `routes/_authenticated/pos/refunds/$refundId.tsx` | `RefundDetailPage` |
| `routes/_authenticated/pos/shifts/$shiftId.tsx` | `ShiftDetailPage` |

The `tab` lives in the URL on the index route (`sales | refunds | shifts | conflicts`),
validated by `utils/search.ts` with `.catch(undefined)` and `stripSearchParams`, so a
bookmarked `/pos?tab=conflicts` opens the queue. Filters (`from`, `to`, `terminalId`,
`receiptNumber`, `status`, `severity`, `offset`) live in the same schema — this is a screen
a manager sends to a colleague, and a filter that lives in `useState` cannot be sent.

### 3. The lists

- **Sales** — receipt, date (`formatDateTime`), branch, terminal, cashier, items, total,
  refunded (if any), conflicts (a badge only when `> 0`). Row click → the detail.
- **Refunds** — number, date, receipt, refunded, reason label from
  `REFUND_REASON_LABELS`, tenders (with a "pending" dot when any tender is not `SETTLED`),
  and an "Approval" link when `approvalId` exists.
- **Shifts** — number, opened/closed, terminal, cashier, counted vs expected, variance
  (signed, with the tone the existing `StatusBadge` uses), review status.
- **Conflicts** — severity badge, type label from `CONFLICT_TYPE_LABELS`, created, branch,
  terminal, receipt or shift, status. Severity sorts HIGH first; the row opens the detail
  sheet.

Empty states use `EmptyState` with one action ("Clear filters"), loading uses
`TableMessage state="loading"` with the row count, errors use `state="error"` with the
request id from `ApiError`.

### 4. The sale detail and the receipt copy

Two panels on one page:

- **Document** — header facts, the line table (SKU, name, qty, unit price, discounts, tax,
  total), the tender table (sequence, method, amount, provider reference when present), the
  refunds against it (link each), the conflicts (link to the queue filtered by
  `saleId`), and a footer with the loyalty figures.
- **Receipt copy** — an 80 mm-wide `ReceiptCopy` component rendered from
  `GET …/sales/:id/receipt`: seller, branch, terminal, receipt number, date, cashier,
  customer name and the **masked** phone, lines, the tax block (VAT/NHIL/GETFund), totals,
  tenders, change, loyalty, footer, the E-VAT block when `evat` is non-null, and a visible
  caption: *Copy of receipt — not a till reprint.* A **Print** button calls
  `window.print()`; `styles.css` already hides the shell, and a `print:` wrapper isolates
  the copy to 80 mm.

The E-VAT block prints the serial, the receipt number, the signature in four groups, the
stamp time and the QR payload as **text** plus a caption that a scannable QR is printed at
the till once GRA onboarding is complete (P14-D39). No QR image is generated from a mock
payload — a fake QR that scans to `evat.mock.invalid` is worse than none.

### 5. The refund and shift details

Refund detail: the same header/lines/tenders the approval subject shows, plus the sale
link, the approval link (or "not required"), and the provider references. No retry, no
void, no edit.

Shift detail: the shift facts, the report (Z for a closed shift, X for an open one) rendered
with the same sections the till prints — sales, tax, tenders, drawer, voids — from
`GET …/shifts/:id`, plus the void rows. A manager can compare the console's Z with the
paper on their desk.

### 6. The conflict sheet

A right-hand sheet (`components/ui/sheet.tsx`) with the conflict's details, the linked
document (a link to the sale or shift detail), the toggle `RESOLVED | DISMISSED`, the code
select from `CONFLICT_RESOLUTION_CODES` with `CONFLICT_RESOLUTION_LABELS`, a note field,
and a submit that is disabled until `resolutionProblem` returns null — the shared function,
not a client re-implementation. The sheet states what it will not do: *"This records a
decision. It does not change the sale, the stock or the ledger."*

### 7. Navigation and the dashboard's link

`sidebar.tsx`: `/pos` in the **Operations** group after Approvals, permission
`pos.oversight.read`, `NavPath` union, `PAGE_LABELS` for `pos`, `pos/sales`,
`pos/refunds`, `pos/shifts` and `pos/conflicts`.

`dashboard/components/needs-attention.tsx`: the conflict tile's `to` changes from `/audit`
to `/pos?tab=conflicts`.

`analytics/pages/tabs/sales-tab.tsx`: the receipt cell becomes a `Link` to
`/pos/sales/$saleId` using the `saleId` Plan 05 added.

### 8. The walkthrough grows five sections

`admin/test/walkthrough-sections.mjs`: add `/pos?tab=sales`, `…=refunds`, `…=shifts`,
`…=conflicts`, and a sale detail visit, each with an assertion in `SECTION_ASSERTIONS` and a
screenshot. The assertions are about content, not presence: the receipt copy shows the
receipt number from the seed and a `TOTAL` figure; the conflict tab shows at least one row
with a severity word; the refund tab shows a refund whose `approvalId` is null.

## Verification

```bash
bun run --filter admin check-types
bun run --filter admin build
bun run modules:check:strict     # 20/20 once the controller adds the module
bun run lint
```

Then run the walkthrough by hand against the demo seed
(`bun run dev:api & bun run dev:admin & bun run db:seed --demo`) and confirm the five new
sections pass and no request is a 4xx/5xx.

## Commits

1. `feat(admin): the pos-oversight module, its routes and its search schema`
2. `feat(admin): sales, refunds, shifts and conflicts lists`
3. `feat(admin): the sale detail and a receipt copy that says it is a copy`
4. `feat(admin): the conflict sheet, resolved with a code and a note`
5. `feat(admin): the nav section, the dashboard link and the analytics receipt link`
6. `test(admin): five walkthrough sections and their assertions`

## Done when

- A manager can go from a receipt number to the sale, its tender split and its refunds in
  two clicks.
- The conflict queue is reachable from the dashboard tile that has been counting it since
  Phase 9.
- The receipt copy reconciles on screen to the same total the till printed, and says which
  document it is.
