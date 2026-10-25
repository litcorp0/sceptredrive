---
phase: 11-procurement-replenishment
plan: 09
title: Console — procurement module (orders, receiving, returns, product submission, invoice matching)
lane: admin
depends_on: [08]
requirements: [PROC-01, PROC-02, PROC-03, PROC-04, PROC-05, MGR-02, MGR-03, MGR-04]
---

# Plan 09 — The section a manager actually uses

## Goal

One console section where a manager orders, receives and returns, and where an admin decides. The
module follows the admin contract exactly — a route file is 25 lines and a barrel import — and
every state the user can see comes from `canApply` computed by the server, never from a client
guess about the lifecycle.

Replenishment and supplier performance screens are Plan 10; this plan only creates the section
shell and the procurement screens.

## Read first

- `admin/src/modules/README.md` — the module contract in full.
- `scripts/check-modules.mjs:39-95,111-167` — what the gate will refuse.
- `admin/src/modules/suppliers/components/supplier-form-dialog.tsx` — the dialog/form conventions
  (controlled `open`, `useEffect` reset, `ApiError` 400/409 inline, `toastApiError` otherwise).
- `admin/src/modules/inventory/components/receive-dialog.tsx` — the existing receipt form; the PO
  receive dialog is a rewrite of it with ordered/outstanding columns.
- `admin/src/modules/inventory/components/transfer-lines-editor.tsx` and
  `admin/src/modules/payables/components/invoice-lines-editor.tsx` — line editors.
- `admin/src/modules/inventory/pages/transfer-new-page.tsx` — a multi-line document form in the
  current style.
- `admin/src/components/layout/sidebar.tsx:36-145,194-223` — `NavPath`, `NAV_GROUPS`,
  `SECTION_LABELS`, `PAGE_LABELS`.
- `admin/src/components/common/{page-header,table-message,pagination,confirm-dialog}.tsx`.

## Tasks

### 1. Module tree `admin/src/modules/procurement/`

| Path | Responsibility |
|---|---|
| `index.ts` | barrel — the only entry other modules and routes may import |
| `api/keys.ts` | `orderKeys`, `approvalKeys`, `returnKeys` factories (`all`, `list(filters)`, `byId(id)`) |
| `api/orders.ts` | fetchers + `queryOptions` for list/detail; the eight order mutations |
| `api/approvals.ts` | list/detail/decide/withdraw |
| `api/returns.ts` | create/list/detail/post/cancel |
| `types/index.ts` | hand-written interfaces mirroring the API (`OrderDetail`, `OrderLine`, `ApprovalSummary`, `ReturnDetail`) |
| `ui/order-status-badge.tsx` | presentational only; words, not colour alone |
| `utils/order.ts` | `statusLabel`, `statusTone`, CSV row mapping, `formatOrderLine` |
| `components/order-list.tsx` | filtered table: status, supplier, expected date, goods value, match/approval flag |
| `components/order-form.tsx` | create/edit a DRAFT (supplier, expected date, note, lines) |
| `components/order-lines-editor.tsx` | product picker + qty + unit cost, add/remove row |
| `components/order-actions.tsx` | submit/send/cancel/close buttons and their dialogs, driven by `canApply` |
| `components/approval-panel.tsx` | the pending decision: value, threshold, requester, approve/reject |
| `components/receive-dialog.tsx` | ordered / previously received / receiving now / outstanding per line |
| `components/return-dialog.tsx` | receipt-line picker, received/returned/returnable, reason |
| `components/order-print-sheet.tsx` | the printable PO (`print:` utilities, no new CSS file) |
| `pages/procurement-layout.tsx` | `PageHeader` + `Tabs` (Orders · Replenishment · Suppliers) + `Outlet` |
| `pages/orders-page.tsx` | composition root |
| `pages/order-new-page.tsx` | composition root |
| `pages/order-detail-page.tsx` | header, lines, approval panel, actions, receipts, returns |
| `pages/product-submission-page.tsx` | the manager's product form |

Every folder appears only when it has content (Phase 8's D2 refinement); the list above is the
full set, not a template with empty folders.

### 2. Routes

| File | Page |
|---|---|
| `admin/src/routes/_authenticated/procurement/route.tsx` | `ProcurementLayout` |
| `admin/src/routes/_authenticated/procurement/index.tsx` | redirect → `/procurement/orders` |
| `admin/src/routes/_authenticated/procurement/orders/index.tsx` | `OrdersPage` |
| `admin/src/routes/_authenticated/procurement/orders/new.tsx` | `OrderNewPage` |
| `admin/src/routes/_authenticated/procurement/orders/$orderId.tsx` | `OrderDetailPage` |
| `admin/src/routes/_authenticated/catalog/products/submit.tsx` | `ProductSubmissionPage` |

The redirect-only index passes the gate's `≤25 lines, no barrel` exemption exactly as
`catalog/index.tsx` does. Every other route is six lines. `src/routeTree.gen.ts` is generated —
never hand-edited.

### 3. Navigation and breadcrumbs

`sidebar.tsx`:

- `NavPath` gains `"/procurement"`.
- `NAV_GROUPS` Operations group gains
  `{ to: "/procurement", label: "Procurement", icon: ClipboardList, permission: "procurement.read" }`.
- `SECTION_LABELS` gains `procurement: "Procurement"`; `PAGE_LABELS` gains `orders`, `new`,
  `replenishment`, `suppliers`, `submit` so the breadcrumb reads *Procurement / Orders / PO-…*.

Permission filtering already exists (`visibleGroups`), so a cashier sees nothing new and a manager
sees the section.

### 4. The order screens

**`orders-page.tsx`** — one table, filters as local state:

- status filter (`All`, `Draft`, `Awaiting approval`, `Approved`, `Sent`, `Partially received`,
  `Received`, `Closed`, `Cancelled`, `Rejected`);
- supplier filter (`SupplierCombobox` from `#/components/common`), search on order number;
- branch column and switcher behaviour via `useBranch()`, identical to `receipts-page.tsx`;
- row: number (mono), supplier, status badge, expected date, goods value (`formatGhs`), approval
  flag ("Awaiting decision" / "Auto-approved"), receipts count;
- `New order` button behind `procurement.create`.

**`order-detail-page.tsx`**:

- header: number, status badge, supplier, branch, expected date, requester;
- money: goods value (ex-tax) with the label *"Goods value (ex-tax)"*, and a secondary line
  *"Approval limit GH₵10,000 — this order was approved automatically"* or *"Awaiting admin
  approval"* from the detail payload;
- lines table: ordered, previously received, outstanding, unit cost, line total;
- `order-actions` renders only the actions `canApply` allows, each with a dialog that requires the
  reason the API requires (cancel reason, close note);
- receipts list (each receipt links to `/inventory/receipts/$receiptId`);
- returns list with the credit note number and amount;
- `Print` button renders `order-print-sheet` and calls `window.print()`;
- `Export CSV` uses `toCsv` from `@sceptre/shared` (the Phase 9 helper) — the formula-injection
  escaping comes with it, do not hand-roll a second CSV writer.

**`receive-dialog.tsx`** — the one screen where a mistake costs money, so:

- every line shows ordered / previously received / receiving now (input, default = outstanding) /
  outstanding after;
- an input above outstanding reveals a **required** reason select (`SUPPLIER_SENT_MORE`,
  `ORDER_ROUNDING`, `SUBSTITUTE`, `OTHER`) and an optional note, inline on that row — not a second
  dialog;
- the footer states the total received quantity and the resulting order status in words
  ("This will leave the order partly received — 4 of 10 outstanding");
- submit is disabled while any over-delivery row lacks a reason, with the reason stated as text
  next to the field (not colour alone).

**`return-dialog.tsx`** — pick receipt lines, cap the input at
`received − already returned`, show the unit cost (read-only, from the receipt) and the credit
value that will be created. The dialog creates the DRAFT and then posts it on a second,
explicitly labelled confirmation inside the same dialog (*"Post return and create credit note"*),
because posting moves stock and money and must not be a single mis-click.

### 5. Product submission

`product-submission-page.tsx` — the manager's form: name, category, unit, brand, description,
proposed selling price, barcode, supplier, note. It posts to `/api/products/submissions` and
returns to `/catalog/products` with a toast: *"Submitted for approval — an admin will decide."*

`admin/src/modules/catalog/pages/products-page.tsx` changes in one place: a **manager** sees
*"Submit a product"* linking to `/catalog/products/submit`; an **admin** keeps *"New product"*.
Both are gated on `catalog.create`, which is why the branch is on role, not permission.

### 6. Derived cost comes off the product form (P11-D13)

`admin/src/modules/catalog/components/product-form.tsx` — remove the "Cost price" input from both
create and edit. On the detail page, replace it with a read-only line:
*"Latest receipt cost: GH₵52.00 — Accra Main, 12 Oct 2026"*, or *"No receipt yet"*. The branch
figure beside stock (`stock_level.avgCostMinor`) stays where it is on the inventory screen.

A test's worth of care without a test harness: the form must not send `costPriceMinor` at all —
the API now rejects the field (Plan 05), so a stray field would surface as a 400 on the first
submission. The browser pass in Plan 11 proves it.

### 7. Access control on the screen (defence in depth, not enforcement)

- Orders: list and detail behind `procurement.read`; create behind `procurement.create`.
- Approve/reject rendered only for `procurement.approve` **and** `canDecide` from the server.
- Receive behind `procurement.receive`; return behind `procurement.return`.
- A manager never sees the branch switcher (existing `useBranch` behaviour) and never sees another
  branch's numbers, because the API refuses them — the console does not filter after the fact.

### 8. Invoice matching on the payables screens (PROC-04's visible half)

Plan 06 made matching real; without a screen it is only reachable by hand-written HTTP.

- `admin/src/components/common/match-status-badge.tsx` — **global**, not inside a module, because
  two modules render it (the same reason `invoice-status-badge.tsx` lives there). Words plus a
  reserved-icon slot: `Matched`, `Price differs`, `Quantity differs`, `Price and quantity differ`,
  `Not on order`, `Not matched`.
- `admin/src/modules/payables/components/invoice-form.tsx` gains an optional **purchase order**
  picker above the lines, filtered to the chosen supplier and branch. When an order is chosen,
  each row shows the ordered unit cost as a **hint beside** the input (never as the input's value):
  a prefilled price would hide the very variance the screen exists to surface. The clerk types
  what the invoice says.
- `invoices-page.tsx` gains a `PO` column and the match badge, plus a `matchStatus` filter.
- `invoice-detail-page.tsx` gains a **match panel**: order number, and per line
  invoiced / received / ordered quantity and invoiced / ordered unit cost, with the variance
  named. The sentence above it is fixed copy: *"A difference is recorded, not blocked — this
  invoice still posts to the supplier balance."*

The invoice form must not send `purchaseOrderLineId` guesses: it sends the order id and lets the
API match by product (Plan 06), so the screen cannot invent a link the order does not have.

### 9. Module gate (controller, same commit as the directories)

`scripts/check-modules.mjs:39-55` — add `'procurement'` to `REQUIRED_MODULES` alphabetically,
**in the commit that creates `admin/src/modules/procurement/`**. `replenishment` is added by
Plan 10 for the same reason. A required module whose directory is absent is a hard gate failure,
so the list may only ever name directories that exist on disk.

## Verification

```bash
bun run modules:check
bun run modules:check:strict
bun run --filter admin check-types
bun run --filter admin lint
bun run lint
```

Then, with the stack up (`bun run dev:api`, `bun run dev:admin`, seeded database), walk:

1. manager: create a draft below the limit → submit → lands `Approved` with *"approved
   automatically"*; create one above the limit → `Awaiting approval`;
2. admin: open the pending order from the filtered list → approve → `Approved`; send it → `Sent`;
   print the sheet and confirm the browser print preview shows only the order;
3. receive 6 of 10 → `Partially received` with 4 outstanding; receive 4 → `Received`;
4. create a return of 2, confirm it posts, and see the credit note number on the order and the
   reduced balance on `/suppliers`;
5. manager: *"Submit a product"* → visible on `/catalog/products` only after the admin approves;
6. admin: open a product detail and confirm the cost line is read-only and says where it came
   from.

Every step's numbers are re-checked in Plan 11's walkthrough script; this pass is to catch layout
and copy problems, not to be the evidence.

## Commits

1. `feat(admin): procurement module shell, routes and navigation`
2. `feat(admin): order list, draft form and line editor`
3. `feat(admin): order detail, lifecycle actions and the approval panel`
4. `feat(admin): receive against an order with over-delivery reasons`
5. `feat(admin): purchase return and credit note flow`
6. `feat(admin): manager product submission and read-only derived cost`
7. `feat(admin): invoice matching on the payables screens`
8. `chore(scripts): require the procurement module in the admin gate`

## Done when

- `/procurement/orders` lists, filters and opens orders for the right branch only.
- Every action button comes from `canApply`; a screen cannot offer an illegal transition.
- Submitting, approving, sending, receiving and returning all work end to end in a browser.
- `modules:check:strict` is green with `procurement` in `REQUIRED_MODULES`.
- No route file exceeds 25 lines and none imports a module internal.
- The product form no longer offers a cost field, and a manager is routed to submission rather
  than creation.
- An invoice can be matched to an order from the console, and both values of a variance are
  visible on its detail page.
