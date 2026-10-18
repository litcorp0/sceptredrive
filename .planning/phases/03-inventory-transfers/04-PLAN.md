---
phase: 03-inventory-transfers
plan: 04
wave: 4
title: Transfers module — draft, dispatch, receive, short-close
requirements: [INV-05, INV-09]
depends_on: [02, 03]
status: planned
created: 2026-10-18
---

# Plan 04 — Transfers Module

**Goal:** Goods move between any two branches through a draft → dispatch → receive
lifecycle with partial receives, explicit short-closes, carried costs, and branch-side
authority — every stock effect transactional and audited.

## Task 1 — Transfer draft lifecycle

**Files:** `api/src/modules/transfers/transfers.routes.ts`, `transfers.validation.ts`,
`transfers.controller.ts`, `transfers.service.ts`, `transfers.repository.ts`,
`transfers.types.ts` (schema from Plan 01), `api/src/app.ts`

- Zod: create `{ fromBranchId, toBranchId, note?, lines: [{ productId,
  quantityRequested (int ≥1) }] (1–100, unique productId) }`; lines-replace
  `{ lines: [...] }`; list query `branchId?`, `status?`, `limit`/`offset`.
- Service:
  - `createTransfer` — `assertBranchAccess` on **either** side (a manager may draft with
    their branch as source or destination; admin any); branches must differ (409) and be
    active; products active (409); allocate `TRF-#####`; insert draft + lines; audit
    `transfer.created`.
  - `updateTransfer` (note) and `replaceLines` — `DRAFT` only (409 otherwise); audit
    `transfer.updated` with before/after.
  - `cancelTransfer` — `DRAFT` only; sets `CANCELLED` + actor/time; audit.
  - `listTransfers` / `getTransfer` — branch-scoped (`resolveBranchFilter`-style: rows
    where from or to matches the manager's branch; admin all, optional `branchId` filter).
- Register routes in `app.ts` (this plan serializes after Plan 03 for the shared file).

**Verify:** tests: manager drafts in both directions, from=to 409, inactive branch/product
409, non-draft edit/cancel 409, list scoping shows only own-branch transfers to a manager,
route-level permission `inventory.transfer`.
**Commit:** `feat(api): add transfer drafts with branch-scoped listing`

## Task 2 — Dispatch

**Files:** transfers module files

- `POST /api/transfers/:id/dispatch` — body `{ lines: [{ productId, quantityDispatched
  (int ≥0) }] }` (must cover every line; each ≤ requested; at least one > 0); source-side
  authority (`assertBranchAccess(user, transfer.fromBranchId)`); status must be `DRAFT`
  (409 otherwise).
- Service (one transaction): read lines; call `postMovements` with sorted
  `TRANSFER_OUT` inputs (delta = −quantityDispatched; `unitCostMinor` = source current
  average — captured via the posting service; `referenceNumber` = TRF number); any
  insufficient line rolls the whole dispatch back (409 listing the product); set line
  `quantityDispatched` + `unitCostMinor`, status `DISPATCHED`, `dispatchedBy`/`dispatchedAt`;
  audit `transfer.dispatched` with per-line quantities and total cost.

**Verify:** tests: dispatch deducts source exactly; average cost unchanged at source;
over-dispatch 409 and nothing written; zero-lines dispatch 400; destination manager
dispatching 403; re-dispatch 409; audit content.
**Commit:** `feat(api): add transfer dispatch with atomic stock movements`

## Task 3 — Receive and short-close

**Files:** transfers module files

- `POST /api/transfers/:id/receive` — body `{ lines: [{ productId, quantityReceived
  (int ≥0) }] }`; destination-side authority; status `DISPATCHED`; each line
  `≤ dispatched − received` and at least one > 0; 409 on over-receive.
- Service (one transaction): `TRANSFER_IN` movements per line (cost = line
  `unitCostMinor`; blends destination average per D2), bump `quantityReceived`; if every
  line is fully received → status `RECEIVED` + `receivedBy/At`; otherwise stays
  `DISPATCHED`; audit `transfer.received` (per line + whether it completed).
- `POST /api/transfers/:id/short-close` — `{ note (required, ≤300) }`; destination-side;
  status `DISPATCHED` and pending > 0; sets `SHORT_CLOSED`, `closedBy/At`; audit
  `transfer.short_closed` with per-line shortfall (`dispatched − received`). No
  compensating movement (D5).
- Receive after short-close → 409; short-close with zero pending → 409.

**Verify:** tests: partial receive twice → full completion; destination average blends at
carried cost; over-receive 409; source manager receiving 403 (admin allowed); short-close
records shortfalls and blocks further receives; company-wide sum of levels decreases by
the shortfall after short-close (no double write-off).
**Commit:** `feat(api): add transfer receive and short-close`

## Done When

A transfer can be drafted in either direction, dispatched only by the source with
all-or-nothing stock movement, received partially or fully at the destination with cost
carried, and short-closed explicitly; every step is branch-authorized and audited.
