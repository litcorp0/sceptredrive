---
phase: 12-branch-ops-approvals
plan: 09
title: Cycle counts — schedules, ABC classes, trigger counts and accuracy
lane: api
depends_on: [03, 04, 05]
requirements: [CC-01, CC-02, CC-03, CC-04, CC-05]
---

# Plan 09 — Counting what the money is in, without remembering to

## Goal

Counts happen because a schedule says so, not because somebody remembered. Every active part is
counted at least once per period, the parts that matter most are counted most often, a drift raises
its own count, and the branch can state how accurate its stock figure is with a number that comes
from the ledger.

## Read first

- `00-DECISIONS.md` P12-D28 … P12-D34.
- `packages/shared/src/counting.ts` (Plan 01) — `advanceDueDate`, `abcClassFromShare`,
  `countAccuracyBp`, `rotationBatchSize`.
- `api/src/modules/counts/` — all seven files, especially `counts.service.ts:61-124` (create +
  category subtree) and `counts.repository.ts:88-134` (variance + snapshot).
- `api/src/modules/inventory/inventory.service.ts:532-565` and
  `inventory.repository.ts:376-435` — the stock read.
- `api/src/modules/pos/pos.schema.ts` (`sale`, `sale_line`), `pos.repository.ts`,
  `pos.conflicts.ts:25-50`.
- `api/src/jobs/queues.ts` — the loyalty expiry queue as the template (cron, `tz`, `missed`).
- `api/src/modules/analytics/analytics.repository.ts` — the inventory read model to extend.

## Tasks

### 1. A product-sales read the counts module may call

`pos.service.ts` (read-only addition):

```ts
/** Ex-tax base sold per product for a branch in a window. Empty map when nothing sold. */
export async function sumSoldValueByProduct(
  branchId: string, from: Date, to: Date, executor: DbExecutor = db,
): Promise<Map<string, number>>
```

It reads `sale_line` joined to `sale`, branch-scoped, using `net_minor` (the ex-tax base) — the same
choice Phase 9 made for gross profit, so the ABC score is not inflated by the 20% tax in inclusive
mode. No authorisation: callers are services that already resolved the branch.

### 2. Schedule CRUD (`counts` module)

```ts
createCountSchedule(user, actor, input): Promise<CountScheduleRow>
listCountSchedules(user, query): Promise<{ schedules: CountScheduleRow[]; total: number; branchId }>
updateCountSchedule(user, actor, id, input): Promise<CountScheduleRow>
```

Input shape (Zod, `.strict()`), with the scope key derived server-side so it cannot be
half-configured:

```ts
{ scope: 'CATEGORY', categoryId: uuid, frequency, firstDueAt?: isoDate, assignedTo?: string }
{ scope: 'BRAND',    brandId: uuid,    frequency, firstDueAt?, assignedTo? }
{ scope: 'ABC_CLASS', abcClass: 'A'|'B'|'C', frequency, firstDueAt?, assignedTo? }
{ scope: 'ROTATION',                   frequency, firstDueAt?, assignedTo? }
```

`scopeKey` = `category:<uuid>` | `brand:<uuid>` | `ABC:A` | `ROTATION` (P12-D28). `nextDueAt`
defaults to `firstDueAt ?? advanceDueDate(accraIsoDay(), frequency)`; the first count therefore
happens one period after the schedule is created, never instantly. `(branch_id, scope_key)` is
unique → a second schedule for the same scope is a 409. Only active branches; the branch is the
manager's own, or the admin's `branchId`.

Routes: `GET /api/count-schedules` (`inventory.read`), `POST` and `PATCH /:id`
(`inventory.count`), deactivate with `PATCH { isActive: false }` (no delete: a schedule that ran is
history).

### 3. Scope resolution

```ts
export async function resolveScopeProducts(
  branchId: string, scope: CountScope, scopeKey: string, executor = db,
): Promise<string[]>
```

| Scope | Products |
|---|---|
| `CATEGORY` | the category **and its children** (reuse the existing subtree query) |
| `BRAND` | active products with that `brand_id` |
| `ABC_CLASS` | `stock_abc_class` rows for the branch with that class |
| `ROTATION` | the `rotationBatchSize(activeCount, frequency)` least-recently-counted active products: never-counted first, then oldest `max(posted_at)` from `stock_count_line` on `POSTED` counts |

`ROTATION` is why `rotationBatchSize` is a shared pure function: 5 000 parts counted weekly is 97
a week, and the arithmetic that says so is testable without a database.

### 4. The snapshot sees every product (P12-D31)

`counts.repository.ts` gains:

```ts
selectProductsWithLevels(branchId: string, productIds: readonly string[], executor = db):
  Promise<Array<{ productId: string; snapshotQty: number }>>
```

`LEFT JOIN stock_level`, `COALESCE(quantity_on_hand, 0)`. `selectSnapshotRows` is replaced by
`resolveScopeProducts` + `selectProductsWithLevels`; `createCount` keeps its behaviour for a manual
category count (same product set, plus the zero-level parts). A product with no level row can now
be counted, and posting a positive variance creates the level row through `postMovements`.

### 5. Creating counts

```ts
createScheduledCount(schedule: CountScheduleRow, executor: DbExecutor): Promise<string | null>
createTriggerCount(branchId, productId, reason: CountTriggerReason, sourceId: string | null, executor): Promise<string | null>
```

- Both return `null` when the partial unique index already has an open count for the same
  `schedule_id` / `trigger_product_id` — a skipped duplicate is not an error.
- A scheduled count: `countType: 'SCHEDULED'`, `scope`, `scopeKey`, `dueAt = schedule.nextDueAt`,
  `assignedTo = schedule.assignedTo`, `scheduleId`.
- A trigger count: `countType: 'TRIGGER'`, `triggerReason`, `triggerProductId`, `triggerSourceId`,
  one line, `dueAt = today + 7 days`, `assignedTo` null.
- Both allocate an `inventory.countSequence` number and audit `count.created` with
  `{ via: 'schedule' | 'trigger', reason }`.

### 6. Trigger counts

**Variance trigger** — in `postCount`, after the movements are posted and before the audit:

```ts
const tolerance = await getSettingValue('inventory.countVarianceToleranceMinor', { branchId }, tx)
for (const line of countedLines) {
  const value = Math.abs(line.variance) * line.unitCostMinor
  if (value > tolerance) await createTriggerCount(branchId, line.productId, 'VARIANCE', countId, tx)
}
```

`unitCostMinor` is the cost the `COUNT_VARIANCE` movement carried, so the trigger threshold and the
ledger use one number.

**Oversell trigger** — a nightly job (P12-D32), never inside `applySale`:

```sql
SELECT branch_id, details->>'productId' AS product_id, count(*) AS n
FROM sync_conflict
WHERE type = 'STOCK_OVERSELL' AND created_at > now() - interval '30 days'
GROUP BY 1, 2 HAVING count(*) >= 2
```

For each row, `createTriggerCount(branchId, productId, 'OVERSELL', null, db)`; the index makes a
second scan idempotent. The threshold (2) and window (30 days) are constants in the service with a
comment naming D17 — not settings, because a branch that can raise them has no trigger.

### 7. ABC classes

```ts
export async function recomputeAbcClasses(branchId: string, executor = db): Promise<{ updated: number; skipped: number }>
export async function listAbcClasses(user, query): Promise<{ classes: AbcRow[]; branchId }>
export async function setAbcClassManually(user, actor, productId, input: { abcClass: 'A'|'B'|'C'; manual: boolean }): Promise<void>
```

`recomputeAbcClasses`:

1. `valueMinor` = `quantity_on_hand × avg_cost_minor` from `stock_level`.
2. `soldMinor` = `sumSoldValueByProduct(branchId, now - 90 days, now)`.
3. `score = valueMinor + soldMinor`.
4. Sort by score desc (tie-break product id), accumulate `shareBp = ratioBp(cumulative, total)`.
5. `abcClassFromShare(shareBp, abcAThresholdBp, abcBThresholdBp)`.
6. Upsert `stock_abc_class`, **skipping** rows with `is_manual = true` (count them as `skipped`).
7. One transaction per branch; a failure leaves that branch's previous classes intact.

`setAbcClassManually` sets the class and `is_manual` (an admin can clear the flag to return the
product to the derived class), audits `stock.abc_class_changed` with before/after, and requires
`inventory.threshold` (admin has it; managers do not).

Routes: `GET /api/counts/abc` (`inventory.read`), `PATCH /api/counts/abc/:productId`
(`inventory.threshold`), `POST /api/counts/abc/recompute` (`inventory.threshold`, admin-only — it
exists so a demo and a test can produce classes without waiting for 03:00).

### 8. Accuracy

```ts
export async function getCountAccuracy(user, query: { branchId?; from; to }): Promise<{
  accuracyBp: number | null; countedLines: number; matchedLines: number
  countsPosted: number; countsOnTime: number; varianceValueMinor: number; branchId: string | null
}>
```

- Counts: `status = 'POSTED'` and `posted_at` in the window, branch-scoped.
- `countedLines` = lines with `counted_qty IS NOT NULL`; `matchedLines` = those equal to
  `snapshot_qty`; `accuracyBp = countAccuracyBp(matched, counted)` (`null` when counted is 0).
- `countsOnTime` = posted counts with `due_at` not null and `posted_at::date <= due_at`.
- `varianceValueMinor` = Σ over `stock_movement` where `reference_type = 'COUNT'` and
  `reference_id` in the count ids of `ABS(quantity_delta) * unit_cost_minor` — the ledger, not a
  second arithmetic (P12-D33).

Route `GET /api/counts/accuracy` (`inventory.read`).

### 9. Analytics

`analytics.repository.ts` gains `selectCountAccuracy(branchId, from, to)` returning the same six
figures, and `getInventory` includes `countAccuracy`. No new endpoint: the analytics inventory tab
already has one. The console tile is Plan 12.

### 10. Jobs

`api/src/jobs/queues.ts`:

| Queue | Cron | Worker |
|---|---|---|
| `inventory-count-schedule` | `0 2 * * *` | `runDueCountSchedules()` — for each active schedule with `next_due_at <= accraIsoDay()`: create the count and set `next_due_at = advanceDueDate(nextDueAt, frequency)`, one transaction per schedule. If the schedule already has an **open** count (the partial unique), the worker skips it **and does not advance** — the schedule waits for that count to be posted or cancelled, rather than silently skipping a period |
| `inventory-abc-recompute` | `0 3 * * *` | `recomputeAllAbcClasses()` — every active branch |
| `inventory-trigger-scan` | `30 3 * * *` | `scanOversellTriggers()` — the query in §6 |

All three: `tz: 'Africa/Accra'`, `missed: 'once'`, `createQueue` before `work` (the loyalty
template). Running the schedule worker twice for the same day must create one count — the partial
unique on `(schedule_id)` plus the `next_due_at` advance are the proof, and the test runs it twice.

### 11. Tests (`counts.test.ts`, `counting-schedule.test.ts`)

- `advanceDueDate` cases from Plan 01 re-proven through the worker (a schedule due 31 Jan produces
  a February count and a 28/29 Feb next due);
- `resolveScopeProducts` for all four scopes on one fixture branch, with hand-counted membership;
- a never-stocked product appears in a scheduled count with `snapshot_qty = 0` and can be posted;
- running `runDueCountSchedules()` twice creates **one** count and advances `next_due_at` once;
- a variance of exactly the tolerance raises no trigger; one pesewa over raises one;
- a second over-tolerance variance on the same product while the trigger is open raises **nothing**
  (partial unique);
- two `STOCK_OVERSELL` conflicts for one product in 30 days raise one trigger; one conflict does
  not; a third scan raises nothing new;
- ABC: three products with hand-computed value/sold → shares 70/25/5 with thresholds 80/95 →
  A/B/C; a manual class survives a recompute; clearing `is_manual` lets the job overwrite it;
- accuracy: 10 counted lines, 7 matched → **7000 bp**; no counted lines → `null`;
- accuracy variance value equals Σ `COUNT_VARIANCE` movements for the same counts;
- analytics `countAccuracy` equals the counts endpoint for the same branch and window;
- `GET /api/counts/accuracy` for another branch's manager → 403.

## Verification

```bash
bun run --filter api test
bun run check-types
bun run lint
```

Expected: API grows by ~35 (the largest plan of the phase). `EXPLAIN (ANALYZE, BUFFERS)` on the
oversell scan and the rotation query is recorded in the plan's evidence if either takes more than
50 ms on the seeded demo month; if `sync_conflict(type, created_at)` is unused by the plan, the
migration index is dropped and the measurement is recorded — the Phase 11 rule for indexes.

## Commits

1. `feat(api): count schedules with scope keys and due dates`
2. `feat(api): snapshot includes never-stocked products`
3. `feat(api): variance and oversell trigger counts`
4. `feat(api): ABC classification per branch with manual override`
5. `feat(api): count accuracy read model and analytics figure`
6. `feat(api): pg-boss jobs for schedules, ABC and triggers`
7. `test(api): rotation, triggers, dedup and accuracy arithmetic`

## Done when

- A schedule creates a count on its due date without anyone remembering, and a re-run creates none.
- Every active part is reachable by a count, including one that has never had a level row.
- A drift raises one count, not one per scan.
- Accuracy is a number derived from posted counts and the ledger, and it is `null` when nothing was
  counted.
