---
phase: 03-inventory-transfers
plan: 05
wave: 5
title: Counts module — snapshot, entry, post
requirements: [INV-06, INV-09]
depends_on: [02, 04]
status: planned
created: 2026-10-18
---

# Plan 05 — Counts Module

**Goal:** A branch stock count snapshots the level book, records counted quantities,
reviews variances, and posts them as compensating ledger adjustments — atomically,
irreversibly, and audited.

## Task 1 — Count creation, entry, and reads

**Files:** `api/src/modules/counts/counts.routes.ts`, `counts.validation.ts`,
`counts.controller.ts`, `counts.service.ts`, `counts.repository.ts`,
`counts.types.ts` (schema from Plan 01), `api/src/app.ts`

- Zod: create `{ branchId, categoryId?, note? (≤300) }`; lines update
  `{ lines: [{ productId, countedQty (int ≥0 nullable) }] }` (max 500, unique productId);
  list query `branchId?`, `status?`, `limit`/`offset`.
- Service:
  - `createCount` — branch access; branch active; allocate `CNT-#####`; snapshot lines in
    one transaction from `stock_level` rows at the branch (joined product; exclude
    archived products; when `categoryId` is set include child categories via
    `listChildCategoryIds`); `snapshotQty` = current level, `countedQty` = null; status
    `OPEN`; audit `count.created` with line count and total snapshot units.
  - `updateCountLines` — `OPEN` only; validates every productId belongs to the count;
    audit `count.updated` (summary, not 500 rows: counts of changed lines + a diff hash).
  - `cancelCount` — `OPEN` only; status `CANCELLED` + actor/time; audit.
  - `listCounts` / `getCount` — branch-scoped (manager own; admin any / all).
- Register routes in `app.ts`.

**Verify:** tests: snapshot matches level book exactly; category filter includes
subcategories and excludes archived products; lines update round trip; non-open edits
409; advance ordering `CNT-00001`; manager other branch 403.
**Commit:** `feat(api): add stock count creation with level snapshot`

## Task 2 — Count posting

**Files:** counts module files

- `POST /api/counts/:id/post`:
  - `OPEN` only (409 otherwise); manager own branch / admin.
  - Variance per line = `countedQty − snapshotQty` for counted lines only (uncounted
    lines are skipped); zero-variance lines produce nothing.
  - Pre-flight inside the transaction: lock affected levels via the posting service path
    (sorted by productId) and reject with 409 listing products whose resulting on-hand
    would be negative (D3/D6) — the count stays `OPEN` so the operator can cancel or
    re-enter.
  - Posts `COUNT_VARIANCE` movements (reference = count number; `unitCostMinor` = current
    average; note = "count variance") for negative and positive variances; sets status
    `POSTED` + `postedBy/At`; audit `count.posted` with per-line variance summary and the
    totals (shortage/overage lines and units).
- Response includes the posted summary (variance lines, net units, net value at cost).

**Verify:** tests: variance math (short/over) posts exactly one movement per line; post
with no counted lines 409; double post 409; post on cancelled 409; negative-result guard
409 with the product list and level state unchanged; ledger invariant holds after post;
audit summary; concurrent movement between open and post survives (variance applied
against snapshot, level updated from current — assert final qty = level at post + Δvariance).
**Commit:** `feat(api): post stock count variances as ledger adjustments`

## Done When

A count opens with an immutable snapshot, accepts counted quantities, survives concurrent
movements, and posts atomic compensating adjustments with full audit — or refuses with a
clear list when physics contradict the book.
