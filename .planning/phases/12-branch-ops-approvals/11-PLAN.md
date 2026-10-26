---
phase: 12-branch-ops-approvals
plan: 11
title: Console — the unified approval inbox and the manager's operations view
lane: admin
depends_on: [10]
requirements: [APR-01, APR-05, BRN-05]
---

# Plan 11 — One place to decide, one place to start the day

## Goal

Every pending request in the organisation is one screen, ordered by how long it has waited, with
the evidence for the decision in front of the person deciding. The manager's landing page says what
needs them today and links to the filtered list behind each number.

## Read first

- `00-DECISIONS.md` P12-D35 … P12-D37.
- `admin/src/modules/README.md:8-18` — the module contract.
- `admin/src/modules/procurement/` — the closest existing module: `api/approvals.ts`,
  `components/approval-panel.tsx`, `components/pending-product-submissions.tsx`,
  `pages/orders-page.tsx`, `types/index.ts:298-351`, `index.ts`.
- `admin/src/modules/analytics/` — the read-model page shape, `PanelState`, the URL-state pattern.
- `admin/src/components/layout/sidebar.tsx:37-156,225-303` — `NavPath`, `NAV_GROUPS`,
  `SECTION_LABELS`, `PAGE_LABELS`, `visibleGroups`, and the unused `SidebarMenuBadge`.
- `admin/src/components/common/` — `status-badge`, `table-message`, `pagination`, `empty-state`,
  `page-header`.
- `admin/src/routes/_authenticated/analytics.tsx` — `validateSearch` + `stripSearchParams`.
- `scripts/check-modules.mjs:39-51` — the module list (a **controller** file).
- `admin/test/walkthrough-sections.mjs` — the regression net this plan must not break.

## Tasks

### 1. Module list (controller edit)

`scripts/check-modules.mjs` `REQUIRED_MODULES` gains `'approvals'` and `'operations'`, alphabetically.
This file belongs to the controller lane: the lane reports `NEEDS_LANE_CHANGE` with the two lines,
and the controller applies them **in the same commit** that creates the directories — a
required-but-absent directory is a hard failure, so the list never runs ahead of the tree.

### 2. The `approvals` module

```text
admin/src/modules/approvals/
  api/keys.ts            approvalKeys { all, list(query), detail(id), summary(branchId) }
  api/approvals.ts       listApprovals, approvalListOptions, getApproval, approvalDetailOptions,
                         decideApproval, withdrawApproval, approvalSummaryOptions
  components/
    approval-filters.tsx        type, status, sort, branch (admin only) — URL-backed
    approval-table.tsx          type, subject, branch, value, requester, age, status
    approval-detail-panel.tsx   header, subject, before/after, note, audit
    subject/
      transfer-subject.tsx      from → to, lines with product, requested, on hand at source
      write-off-subject.tsx     lines with reason and note, frozen value, level after approval
      price-subject.tsx         current → proposed, band, inside/outside, product
      credit-subject.tsx        current limit → proposed, balance, utilisation after
      shift-subject.tsx         expected, counted, variance, cashier, sales, mismatch flag
      purchase-order-subject.tsx  (moved from procurement)
      product-subject.tsx         (moved from procurement)
    decision-dialog.tsx         approve/reject, reason code, note; one button for a variance review
  pages/
    approvals-page.tsx          list + filters + pagination
    approval-detail-page.tsx    detail + decision
  types/index.ts          ApprovalRow, ApprovalListQuery, ApprovalDetail, ApprovalSummary,
                          ApprovalSubject (the eight arms)
  utils/approval.ts       typeLabel, typeTone, subjectSummary, ageWords, valueLabel
  index.ts
```

- The fetchers move from `procurement/api/approvals.ts`; procurement imports
  `#/modules/approvals` from its barrel (a legal cross-module edge, like
  `catalog → procurement` today). `procurement/index.ts` stops exporting them, and the two
  procurement components that used them are updated in the same commit.
- **`canDecide` comes from the server**, never from the client: the detail panel renders the
  decision controls only when `detail.canDecide` is true. A client-side role guess is how a manager
  gets a button that 403s.
- The variance-review subject renders **one** action (*Record outcome*) because that type accepts
  `APPROVED` only (P12-D25). Every other type renders approve and reject.
- Reject opens a reason-code select (`OVER_THRESHOLD`, `PRICE_TOO_HIGH`, `OUT_OF_POLICY`,
  `INCOMPLETE`, `DUPLICATE`, `OTHER`) and a note; the server refuses a rejection without one.
- Age is `formatRelative(requestedAt)` from `@sceptre/shared` — no bare date formatting.
- Value is `formatMinor(amountMinor)` with the type's label ("Goods value", "Proposed price",
  "Proposed limit", "Variance"), so a price and a variance never look like the same kind of number.

### 3. Routes and navigation

```tsx
// admin/src/routes/_authenticated/approvals/index.tsx
export const Route = createFileRoute("/_authenticated/approvals/")({
  validateSearch: approvalSearchSchema,
  search: { middlewares: [stripSearchParams(approvalSearchDefaults)] },
  component: ApprovalsPage,
})
```

Plus `approvals/$approvalId.tsx`. Both are ≤ 25 lines and import exactly one barrel.

`sidebar.tsx` gains one item in `Operations`:

```tsx
{ to: "/approvals", label: "Approvals", icon: Inbox, permission: "approval.read" }
```

`NavPath`, `PAGE_LABELS` and `SECTION_LABELS` are updated together (breadcrumbs are derived from
them).

**The badge** — `AppSidebar` (not the route) runs:

```tsx
const summary = useQuery({ ...approvalSummaryOptions(activeBranchId), staleTime: 60_000 })
const pending = summary.data?.pending ?? 0
// inside SidebarMenuButton, right-aligned:
{pending > 0 ? <SidebarMenuBadge aria-label={`${pending} pending approvals`}>{pending}</SidebarMenuBadge> : null}
```

No `refetchInterval` (P12-D36). The badge is inside the permission-filtered item, so a role
without `approval.read` never mounts the query. It is `aria-label`led because a bare number in a
navigation list is not a label.

### 4. The `operations` module

```text
admin/src/modules/operations/
  api/operations.ts     operationsSummaryOptions(branchId)
  api/keys.ts           operationsKeys { summary(branchId) }
  components/queue-card.tsx   count, label, oldest-age, link to the filtered list
  pages/operations-page.tsx   six cards + accuracy figure + a "start selling" style empty state
  types/index.ts        OperationsSummary, OperationsQueue
  utils/queue.ts        queueLink(kind, branchId) — one place that knows each list's URL
  index.ts
```

- Each card is a link to the filtered list (`/approvals?status=PENDING&type=…`,
  `/inventory/transfers?status=REQUESTED`, `/inventory/write-offs?status=PENDING_APPROVAL`,
  `/approvals?type=SHIFT_VARIANCE_REVIEW`, `/inventory/stock?lowStock=true`,
  `/customers/over-limit`). A count that does not open the list it counts is a dead end.
- A section absent from the response renders nothing (P12-D37) — not a zero card.
- The accuracy figure prints its definition on the card: "7 of 10 counted lines matched" with the
  basis points, because "70.00%" alone does not say what was measured.
- Route `/operations` with `OperationsPage`; sidebar item `{ to: "/operations", label: "Branch operations", icon: LayoutDashboard, permission: "approval.read" }`.
- The page is the **manager's** landing target from the approvals badge; it does not replace the
  dashboard (Phase 9) and does not duplicate its tiles.

### 5. Presentation rules

- Semantic tokens only: `text-muted-foreground`, `bg-card`, `border-border`, `StatusBadge`
  variants. `grep -E "(amber|emerald|sky|red|zinc|neutral)-[0-9]"` over both modules returns
  nothing.
- Tables use `TableMessage` for loading/error/empty and `Pagination` for pages; filters are
  labelled `<select>`/`<Input>` with `aria-label` or a `<Label>`; the decision dialog traps focus
  (Radix `Dialog`) and returns it to the opener.
- Every page is usable at **1024 × 768** and at 1440 px; the tables scroll horizontally rather than
  clipping a column.
- Dates through `@sceptre/shared`; money through `formatMinor`; no `toFixed`.

## Verification

```bash
bun run --filter admin lint
bun run --filter admin build
bun run check-types
bun run modules:check:strict        # 19/19 after the controller's two lines
bun run --filter admin test:walkthrough   # must still be 159/159
```

Plus a manual pass with screenshots into `evidence/shots/`: the inbox empty, the inbox with one
request of each type, one detail per type, the decision dialog, the badge, and the operations page
at 1440 and 1024. The walkthrough extension is Plan 13's job; this plan proves it did not break
the existing one.

## Commits

1. `refactor(admin): approval fetchers and types move to the approvals module`
2. `feat(admin): unified approval inbox with URL filters`
3. `feat(admin): decision screens for every approval subject`
4. `feat(admin): pending-approval badge in the sidebar`
5. `feat(admin): branch operations page`

## Done when

- One screen lists every pending request, oldest first, with type, value, branch, requester and age.
- Each request opens a detail that carries the evidence, and only a decider sees the controls.
- A variance review offers one action; every other type offers approve and reject with a reason.
- The manager's page is six counts and an accuracy figure, each linking to its list.
- The existing console walkthrough still passes at 159/159.
