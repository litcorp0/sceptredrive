---
phase: 10-desktop-pos-redesign
plan: 04
title: Home data layer — reactive queries and pure aggregation
lane: pos
depends_on: [02]
requirements: [UIX-09]
---

# Plan 04 — Home data layer

## Goal

Everything `#home` will display is decided here, before a pixel exists: seven watched queries
over the local database, the pure functions that turn their rows into a day's story, and the
Accra-day hook that keeps "today" true after midnight. No screen is created in this plan.

Every figure comes from rows the terminal already wrote. Nothing here computes a new money
rule, calls the API, or reads a synced ledger.

## Read first

- `00-DECISIONS.md` P10-D1 (terminal scope), P10-D2 (out of stock), P10-D5 (day vs shift
  window), P10-D12 (cheap, throttled, indexed), P10-D13 (midnight).
- `desktop/src/renderer/lib/powersync/schema.ts:183-297` — the exact columns of `sale`,
  `sale_line`, `sale_tender`, `cash_movement`.
- `desktop/src/renderer/lib/shift/shift-service.ts:294-320` and
  `lib/shift/shift-repository.ts:235-265` — the existing expected-cash path to reuse verbatim.
- `desktop/src/renderer/lib/sync/outbox-summary.ts` and `lib/sync/conflicts.ts` — the status
  vocabulary and the existing conflict count.
- `admin/src/modules/dashboard/components/needs-attention.tsx` — the strip's shape, one client
  over. Copy the semantics, not the Tailwind.

## Module shape

```
modules/home/
  api/queries.ts         SQL constants and row types — no React
  hooks/use-home.ts      useQuery wrappers, one per aggregate
  hooks/use-accra-day.ts the midnight boundary
  utils/day.ts           pure: fillHours, peakHour, summarise
  utils/attention.ts     pure: attentionItems
  types/index.ts         AccraDay, HomeSummary, HourPoint, TopSeller, AttentionItem
  index.ts               barrel
```

`api/queries.ts` holds **every** SQL string and every row type; `hooks/` holds only `useQuery`
calls. This is P10-D10's translation of the admin's `api/` folder and it is what makes the SQL
reviewable in one file.

## The seven queries

All are parameterised `(terminalId, from, to)` and every one carries the day window in SQL —
none scans `sale` unbounded (P10-D12). All `useQuery` calls pass `{ throttleMs: 250 }` and the
scalar ones pass `reportFetching: false` so a tile does not flicker while a sale uploads.

### 1. Day header

```sql
SELECT COUNT(*)                              AS sales_count,
       COALESCE(SUM(total_minor), 0)         AS take_minor,
       COALESCE(SUM(tax_total_minor), 0)     AS tax_minor,
       COALESCE(SUM(credit_amount_minor), 0) AS credit_minor,
       COALESCE(SUM(change_minor), 0)        AS change_minor
  FROM sale
 WHERE terminal_id = ? AND occurred_at >= ? AND occurred_at < ?
```

`take_minor` is what customers paid, including tax. `tax_minor` is the part to remit (P10-D5c).
This window spans **all shifts of the day**, which is why the drawer figure is separate.

### 2. Items sold

```sql
SELECT COALESCE(SUM(sl.quantity), 0) AS items_sold
  FROM sale_line sl
  JOIN sale s ON s.id = sl.sale_id
 WHERE s.terminal_id = ? AND s.occurred_at >= ? AND s.occurred_at < ?
```

### 3. Hourly shape

```sql
SELECT CAST(substr(occurred_at, 12, 2) AS INTEGER) AS hour,
       COALESCE(SUM(total_minor), 0)               AS take_minor
  FROM sale
 WHERE terminal_id = ? AND occurred_at >= ? AND occurred_at < ?
 GROUP BY hour
 ORDER BY hour
```

`occurred_at` is written as `new Date().toISOString()`
(`lib/sale/complete-sale.ts:395`), so `substr(…,12,2)` is the UTC hour — and Africa/Accra is
UTC+0 with no DST (`packages/shared/src/dates.ts:1-8`), so it is also the Accra hour. That
equivalence is asserted in a test and stated in a comment; if a future phase ever applies a
non-zero offset, the test fails rather than the dashboard silently shifting.

A day has 24 buckets even where no sale happened: `fillHours` zero-fills, so a quiet morning is
a visible zero, not a missing point (the same rule as P9-D7 on the console).

### 4. Top five sellers

```sql
SELECT sl.product_id            AS product_id,
       sl.name                  AS name,
       SUM(sl.quantity)         AS quantity,
       SUM(sl.total_minor)      AS revenue_minor
  FROM sale_line sl
  JOIN sale s ON s.id = sl.sale_id
 WHERE s.terminal_id = ? AND s.occurred_at >= ? AND s.occurred_at < ?
 GROUP BY sl.product_id, sl.name
 ORDER BY SUM(sl.quantity) DESC, sl.name ASC
 LIMIT 5
```

`sl.name` is the snapshot written at sale time, so a renamed or archived product still reads
correctly and no join to the catalogue is needed. Ranked by **quantity** — a counter cares what
moved — with revenue as the secondary figure. The `name ASC` tiebreak makes the row order
deterministic between queries.

### 5. Expected cash in the drawer

Not a new query. Call `selectShiftCashTotals(db, shiftId, openingFloatMinor)` and
`computeExpectedCash(totals)` — the same two functions the close dialog and the shift screen
already use. `loadShiftState()` returns both; the home hook consumes `expectedCashMinor` and
`shift.number`.

If no shift is open the card reads "No open shift" and links to `#shift`. It never shows the
last close's figure as if it were in the drawer.

### 6. Unprinted receipts

**Read, do not re-write.** Plan 03 extracted the count into `modules/sales/api/queries.ts` and
exported `useUnprintedCount()`. Import it from `@/modules/sales` and use it in the strip. No SQL
is declared here, and this plan does not edit `components/layout/**` — that separation is what
lets Plan 04 run beside Plans 06–08 (README, wave 4).

```sql
-- already lives in modules/sales/api/queries.ts after Plan 03; shown for reference only
SELECT COUNT(*) AS count FROM sale
 WHERE print_status IN ('PENDING', 'FAILED', 'PRINTING')
```

### 7. Open conflicts and waiting uploads

Reuse the existing hooks rather than re-writing their SQL: `useOutboxSummary()` for
`pending`/`failed`, and the conflict count already used by `sync-badge.tsx`
(`status = 'OPEN'`, with the `HIGH` severity figure). If either SQL has to move to satisfy the
module boundary, it moves into `modules/sync/api/queries.ts` and the header keeps importing it
from there.

### 8. Out of stock now

```sql
SELECT COUNT(*) AS count
  FROM stock_level sl
  JOIN product p ON p.id = sl.product_id AND p.is_active = 1
 WHERE sl.branch_id = ? AND sl.quantity_on_hand <= 0
```

Branch id comes from `usePosRuntime().identity.branchId`. Documented limit (P10-D2): a product
with no `stock_level` row at this branch does not appear; the caption says "at this branch".

## Pure functions

```ts
// utils/day.ts
export interface HourPoint { hour: number; takeMinor: number }
export function fillHours(rows: ReadonlyArray<{ hour: number; take_minor: number }>): HourPoint[]
export function peakHour(points: ReadonlyArray<HourPoint>): number | null   // null when all zero
export function homeSummary(args: {...}): HomeSummary                        // assembles, never sums money twice

// utils/attention.ts
export interface AttentionItem {
  id: 'unprinted' | 'conflicts' | 'uploads' | 'out-of-stock'
  count: number
  label: string
  detail: string
  tone: 'warn' | 'danger' | 'info'
  route: string          // where the cashier can act
}
export function attentionItems(counts: {...}): AttentionItem[]   // zero-count items omitted
```

`homeSummary` takes the row from query 1, the items count, and the expected cash, and returns
the tiles' values. It **uses `averageBasketMinor` from `@sceptre/shared`** (P10-D3) and does no
arithmetic of its own beyond that. Average basket is `0` when there are no sales, and the tile
shows "—" rather than `GHS 0.00` in that case (a currency figure for "we have not sold
anything" reads as a bug).

## The midnight boundary (P10-D13)

```ts
// hooks/use-accra-day.ts
export function useAccraDay(): string   // "2026-10-25", re-renders at the next Accra midnight
```

One `setTimeout(msUntilNextAccraDay(Date.now()) + 2_000)`, re-armed on each firing, cleared on
unmount. The +2 s guard absorbs timer drift across a suspend/resume without ever landing on the
previous day. Pure part (`msUntilNextAccraDay`) is tested in Plan 01; this hook is tested by a
fake-timer case asserting the returned day flips once.

## Tests

`utils/day.test.ts`:

- `fillHours([])` returns 24 zeroed points, hours 0…23 in order;
- rows out of order, duplicated hours, and hour 0 / hour 23 land in the right slots;
- `peakHour` on an all-zero day is `null`; on a tie it returns the earlier hour;
- `homeSummary` with no sales yields take 0, count 0, average **0**, and the UI contract for
  zero ("—") is asserted at the type/flag level here, so the screen cannot invent it later;
- a day with one `GHS 150.00` sale and one `GHS 95.00` sale yields take `24500` and average
  `12250`; and the API's own fixture (`45_000` over three sales → `15_000`,
  `analytics.test.ts:462-463`) is pinned here too, so the two clients cannot round a basket
  differently. *(The first figure is `packages/shared/src/money.test.ts`'s case, not the API's —
  plan text corrected after execution.)*

`utils/attention.test.ts`: zero counts produce `[]`; each item carries the route a cashier can
actually reach; `HIGH` conflicts raise the tone to `danger`; every item's count is a safe
integer.

`api/queries.test.ts` (or the Electron harness if the VFS does not run in Node — same
substitution rule as Plan 01): seed one shift, three sales across two hours, lines, and a
tender; run all seven statements; assert exact values and that the day filter excludes a sale
written a minute before midnight of the previous day.

## Verification

```bash
bun run --filter desktop test
bun run --filter desktop check-types
bun run lint
bun run modules:check:pos
```

Expected: the desktop suite grows by ~20 cases; `home` remains the only pending module; nothing
renders yet, so no screenshot changes.

## Commits

1. `feat(desktop): home queries and the Accra day hook`
2. `feat(desktop): home aggregation and attention items with tests`

## Done when

- Seven watched queries exist, all day-bounded, throttled, and indexed by Plan 01's
  `sale_terminal_occurred`.
- Expected cash reuses `selectShiftCashTotals` + `computeExpectedCash`; no second cash formula
  exists anywhere.
- Average basket comes from `@sceptre/shared`, and a test pins the POS and the API to the same
  fixture.
- The hour bucket is UTC (= Accra) by construction, and a test fails if a non-zero offset is
  ever introduced.
- `useAccraDay` flips the day at the boundary under fake timers.
- Nothing outside `modules/home` changed, with one deliberate exception: the conflict-count SQL
  moves into `modules/sync/api/queries.ts` as `useOpenConflictCounts()`, because restating it in
  `home` would be the duplication §7 forbids and deep-importing it would fail the gate.
