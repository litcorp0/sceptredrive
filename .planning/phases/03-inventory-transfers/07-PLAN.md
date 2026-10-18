---
phase: 03-inventory-transfers
plan: 07
wave: 7
title: Console — transfers and stock count screens
requirements: [ADM-04, INV-05, INV-06]
depends_on: [04, 05, 06]
status: planned
created: 2026-10-18
---

# Plan 07 — Console Transfers & Counts

**Goal:** Managers move stock between branches and run stock counts entirely from the
console: draft in either direction, dispatch, partial receive, short-close, count entry,
and posting — with status-driven actions and clear discrepancy visibility.

## Task 1 — Transfers screens

**Files:** `admin/src/routes/_authenticated/inventory/transfers.tsx`,
`admin/src/routes/_authenticated/inventory/transfers.new.tsx`,
`admin/src/routes/_authenticated/inventory/transfers.$id.tsx`,
`admin/src/lib/api-types.ts`, `admin/src/lib/api.ts`

- List: filters (status, direction: from/to my branch; admin may filter branch),
  columns TRF number, from → to, status badge, line count, units dispatched/received,
  created; row → detail; "New transfer" button (`inventory.transfer`).
- New transfer page: source/destination branch selects (inactive branches excluded;
  manager's branch defaults to one side), product lines via the product picker with
  requested quantities, note; save → detail page.
- Detail page: header (number, status, branches, timestamps, note); lines table with
  requested / dispatched / received / pending columns; actions by status + side:
  - `DRAFT`: edit lines/note, cancel (confirm dialog). Source or destination manager.
  - `DISPATCHED`: Dispatch form (pre-filled with requested; per-line editable qty), for
    the source manager only — shows source on-hand per line and blocks over-dispatch
    client-side with server 409 fallback; Receive form (per-line receive qty, defaults to
    pending) for the destination manager; Short-close dialog (note required) when pending
    > 0.
  - `RECEIVED` / `SHORT_CLOSED` / `CANCELLED`: read-only with discrepancy summary
    (shortfall units per line highlighted).
- Query keys `['transfers']`, `['transfer', id]`; invalidate stock keys after
  dispatch/receive/short-close.

**Verify:** create → dispatch → partial receive → complete, watching stock numbers move
in the stock screen; short-close shows the discrepancy summary; manager on the wrong side
sees read-only actions.
**Commit:** `feat(admin): add transfer screens with dispatch and receive flows`

## Task 2 — Stock count screens

**Files:** `admin/src/routes/_authenticated/inventory/counts.tsx`,
`admin/src/routes/_authenticated/inventory/counts.new.tsx`,
`admin/src/routes/_authenticated/inventory/counts.$id.tsx`,
`admin/src/lib/api-types.ts`, `admin/src/lib/api.ts`

- List: columns CNT number, branch, status badge, lines, variance summary (for posted),
  created/posted timestamps; "New count" (`inventory.count`).
- New count page: branch (manager fixed), optional category filter (grouped select),
  note; creates `OPEN` count with the snapshot and navigates to entry.
- Entry page: lines table with snapshot qty, counted qty input (blank = not counted),
  live variance chip (short/over/ok), search filter, "Save progress" and "Post count"
  (confirm dialog showing shortage/overage line counts and net units); posted/cancelled
  views are read-only with the variance summary; cancel action while open.
- Post failures (409 from the negative guard) surface the offending products and keep the
  page editable.

**Verify:** count a demo branch, enter quantities including a deliberate shortage,
post, and confirm the stock screen and history show the variance movement with the CNT
reference; cancel path works; manager sees only own branch.
**Commit:** `feat(admin): add stock count screens with entry and posting`

## Done When

Every INV-05/INV-06 workflow is operable from the console with status-driven UI, correct
stock effects visible in the stock screens, and server-side guards surfaced as clear
messages.
