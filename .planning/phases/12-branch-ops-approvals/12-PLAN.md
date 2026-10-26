---
phase: 12-branch-ops-approvals
plan: 12
title: Console — request screens for transfers, write-offs, price and credit
lane: admin
depends_on: [11]
requirements: [BRN-01, BRN-02, BRN-03, BRN-05, MGR-04, MGR-05, CC-04]
---

# Plan 12 — Every request has a form, and every form says what happens next

## Goal

A manager can raise each of the four requests from the screen where the need arises, and can see
that it is waiting. An admin's direct path stays direct. The console never offers an action the API
will refuse, and never hides one it would allow.

## Read first

- `00-DECISIONS.md` P12-D10, P12-D13, P12-D19, P12-D21, P12-D35.
- `admin/src/modules/inventory/pages/transfers-page.tsx`, `transfer-new-page.tsx`,
  `transfer-detail-page.tsx`, `components/transfer-form.tsx`, `components/transfer-quantity-dialog.tsx`.
- `admin/src/modules/catalog/components/price-overrides.tsx`,
  `admin/src/modules/catalog/pages/product-detail-page.tsx`.
- `admin/src/modules/credit/components/credit-profile-dialog.tsx`,
  `admin/src/modules/credit/pages/credit-aging-page.tsx`.
- `admin/src/modules/approvals/` (Plan 11) — `approvalListOptions`, `ApprovalDetail`.
- The API contracts from Plans 04–07 and 09.

## Tasks

### 1. Transfers (`inventory` module)

- `transfers-page.tsx`: the status filter gains `REQUESTED`, `APPROVED`, `REJECTED`; the button
  reads **Request transfer** for a manager and **New transfer** for an admin; a status column uses
  `StatusBadge` with `REQUESTED`/`APPROVED` as `info`, `REJECTED` as `danger`.
- `transfer-new-page.tsx`:
  - manager: the **to** branch is fixed to the active branch (a read-only field with the branch
    name), the **from** branch is the choice, and a `StatusNote` says "The source branch manager
    approves this request before stock moves."
  - admin: unchanged (draft, dispatch immediately).
- `transfer-detail-page.tsx`:
  - an approval card: status, requester, decider, decided at, reason;
  - dispatch is rendered only when `transfer.canDispatch` (server-computed);
  - a `REQUESTED` transfer shows **Withdraw request** instead of Cancel, with copy naming the
    branch whose manager must decide;
  - a `REJECTED` transfer shows the reason and offers no transition.

### 2. Write-offs (`inventory` module)

New files: `api/writeoffs.ts`, `api/keys.ts` (extend), `components/write-off-form.tsx`,
`components/write-off-lines-editor.tsx`, `components/write-off-detail.tsx`,
`pages/write-offs-page.tsx`, `pages/write-off-new-page.tsx`, `pages/write-off-detail-page.tsx`,
types and barrel exports.

Routes: `/inventory/write-offs`, `/inventory/write-offs/new`,
`/inventory/write-offs/$writeOffId` — three thin route files, each ≤ 25 lines.

- The form: a product picker showing on-hand at the branch (from `GET /api/inventory/stock`), a
  quantity, a reason select (`DAMAGE`, `EXPIRY`, `OBSOLESCENCE`, `THEFT`, `SUPPLIER_FAULT`,
  `OTHER`), and a note input that becomes **required** when the reason is `THEFT` or `OTHER`
  (the client mirrors the server rule; the server still refuses).
- The value is shown live at the branch's average cost, with the sentence "This is the value the
  admin will approve" — the figure is frozen at submit.
- The detail: status, number, lines with reason and note, value, approval state, cancel while
  pending.
- **No write-off form for an admin**: an admin sees the direct adjustment screen instead, and the
  write-offs list shows a `StatusNote` explaining that admins adjust directly (P12-D3).

### 3. Price (`catalog` module)

- `price-overrides.tsx`: the dialog computes `withinPriceBand(current, proposed, bandPercent)` from
  the band the API returns on the product detail (add `managerBandPercent` to the product detail
  payload or a small `/api/products/:id/prices` response field — choose the latter: the prices
  endpoint already answers "what are this product's prices").
- Inside the band: the primary button reads **Save price**; outside: **Request price change**, with
  a `StatusNote` showing the bounds ("Between GH₵90.00 and GH₵110.00").
- A manager's request that returns `{ status: 'PENDING_APPROVAL' }` shows a toast with a link to
  the approval, and the branch row displays "Waiting for approval" from
  `approvalListOptions({ entityId: productId, status: 'PENDING' })`.
- An admin sees no band copy and gets `APPLIED` for the same edit.

### 4. Credit (`credit` module)

- `credit-profile-dialog.tsx`: for a manager, when the typed limit is **greater** than the current
  one, the primary button becomes **Request increase** and a required reason textarea appears; the
  mutation calls `POST /api/credit/profiles/:customerId/limit-requests`. A decrease or an unchanged
  limit keeps the existing save. The admin keeps the single save.
- The customer detail shows a `StatusNote` when a limit request is pending, with a link to it.
- New page `credit-over-limit-page.tsx` + route `/customers/over-limit`, table of
  `GET /api/credit/over-limit` (customer, phone, limit, balance, over by) with a link to the
  customer. The aging page gains a link to it; the operations card points at it.

### 5. Analytics accuracy tile

`analytics` module: the inventory tab renders a "Count accuracy" card from
`countAccuracy` (Plan 09): `accuracyBp` as a percentage with `formatBasisPoints`, the sentence
"7 of 10 counted lines matched", counts posted, counts on time, and variance value. `null` renders
"—" with "No count posted in this period", never `0.00%`.

### 6. Presentation and gates

The same rules as Plan 11: semantic tokens only, `TableMessage`/`Pagination`/`EmptyState`,
labelled controls, focus returned after a dialog, 1024 × 768 and 1440 px, dates from
`@sceptre/shared`, money via `formatMinor`. No client-side permission guess replaces a server field:
`canDispatch`, `canDecide`, `status` and `PENDING_APPROVAL` all come from the API.

## Verification

```bash
bun run --filter admin lint
bun run --filter admin build
bun run check-types
bun run modules:check:strict        # 19/19
bun run --filter admin test:walkthrough   # still 159/159
```

Plus screenshots into `evidence/shots/`: the request form, the request awaiting approval, the
rejection copy, the write-off form with a `THEFT` note required, the price band warning, the credit
request, the over-limit table, and the accuracy card — each at 1440 px, plus the two forms at
1024 × 768. Plan 13 turns these into walkthrough assertions.

## Commits

1. `feat(admin): transfer requests from the branch that needs the stock`
2. `feat(admin): write-off request screens`
3. `feat(admin): price band warning and price-change requests`
4. `feat(admin): credit limit requests and the over-limit list`
5. `feat(admin): count accuracy on the analytics inventory tab`

## Done when

- Each request can be raised from the screen that motivates it, and the screen says who decides.
- A manager sees no form the API would refuse and no button that would 403.
- A pending request is visible where the work started, not only in the inbox.
- The over-limit list opens from the manager's page and from credit aging.
