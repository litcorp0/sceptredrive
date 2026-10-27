import { type DbExecutor, db } from '@sceptre/db'
import { accraIsoDay, advanceDueDate, rotationBatchSize } from '@sceptre/shared'
import { assertBranchAccess, resolveBranchFilter, roleOf } from '../../auth/scope.ts'
import { actorLabel } from '../../http/audit-context.ts'
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../http/errors.ts'
import type { SessionUser } from '../../http/factory.ts'
import { logger } from '../../logger.ts'
import { findBrandById, listChildCategoryIds } from '../catalog/catalog.repository.ts'
import { findLevel } from '../inventory/inventory.repository.ts'
import * as inventoryService from '../inventory/inventory.service.ts'
import * as branchesService from '../org/branches.service.ts'
import { writeAudit } from '../platform/audit.service.ts'
import type { AuditActor } from '../platform/audit.types.ts'
import { isUniqueViolation, uniqueViolationConstraint } from '../platform/db-errors.ts'
import { allocateFromSequence, getSettingValue } from '../platform/settings.service.ts'
import * as posService from '../pos/pos.service.ts'
import { findProductById } from '../products/products.repository.ts'
import {
  countBranchActiveProducts,
  countCounts,
  countSchedules,
  findAbcRow,
  findCategoryName,
  findCountById,
  findCountByIdForUpdate,
  findCountLine,
  findLevelValue,
  findScheduleByIdForUpdate,
  insertCount,
  insertCountLines,
  insertSchedule,
  recomputeAbcRows,
  selectAbcProductIdsByClass,
  selectAbcRows,
  selectActiveBranchIds,
  selectActiveProductIdsByBrand,
  selectActiveProductIdsByCategory,
  selectCountAccuracy,
  selectCountBase,
  selectCountLines,
  selectCountPage,
  selectDueSchedules,
  selectOversellConflicts,
  selectProductsWithLevels,
  selectRotationProductIds,
  selectSchedulePage,
  selectStockedProductIds,
  updateAbcClassRow,
  updateCountLine,
  updateCountRow,
  updateScheduleRow,
  upsertAbcRow,
} from './counts.repository.ts'
import type {
  AbcListQuery,
  AbcManualInput,
  AbcRecomputeResult,
  AbcRow,
  CountAccuracy,
  CountAccuracyQuery,
  CountCreateInput,
  CountDetail,
  CountFrequency,
  CountLinesUpdateInput,
  CountListQuery,
  CountListRow,
  CountScheduleCreateInput,
  CountScheduleFilters,
  CountScheduleListQuery,
  CountScheduleRow,
  CountScheduleUpdateInput,
  CountScope,
  CountTriggerReason,
  StockCountRow,
} from './counts.types.ts'

async function loadCountDetail(id: string): Promise<CountDetail> {
  const base = await selectCountBase(id)
  if (!base) throw new NotFoundError('Stock count not found')
  const lines = await selectCountLines(id)
  return {
    ...base,
    lineCount: lines.length,
    countedCount: lines.filter((line) => line.countedQty !== null).length,
    varianceUnits: lines.reduce((sum, line) => sum + (line.variance ?? 0), 0),
    lines,
  }
}

function assertOpen(row: StockCountRow): void {
  if (row.status !== 'OPEN') {
    throw new ConflictError('Only open counts can be changed')
  }
}

function assertCountAccess(user: SessionUser, row: StockCountRow): void {
  assertBranchAccess(user, row.branchId)
}

/** The audit actor for work a schedule started, not a person. */
function systemActor(): AuditActor {
  return { actorId: null, actorStaffId: null, ip: null, userAgent: null, requestId: null }
}

// --- Scope resolution (P12-D28) ---------------------------------------------

function scopeKeyValue(scopeKey: string, prefix: string): string {
  if (!scopeKey.startsWith(prefix) || scopeKey.length === prefix.length) {
    throw new ValidationError(`The schedule scope key is not a ${prefix} key`)
  }
  return scopeKey.slice(prefix.length)
}

/**
 * The products a scope covers, exactly as P12-D28 defines it.
 *
 * `CATEGORY` includes the child subtree; `BRAND` is the active catalogue for
 * that brand; `ABC_CLASS` is the branch's derived class; `ROTATION` is the
 * smallest batch that still covers the branch's active catalogue once per
 * period, least-recently-counted first (never counted before anything else).
 *
 * The frequency is only meaningful for `ROTATION`, so it is an optional fifth
 * argument rather than a fourth: the published shape keeps the executor there.
 */
export async function resolveScopeProducts(
  branchId: string,
  scope: CountScope,
  scopeKey: string,
  executor: DbExecutor = db,
  frequency?: CountFrequency,
): Promise<string[]> {
  switch (scope) {
    case 'CATEGORY': {
      const categoryId = scopeKeyValue(scopeKey, 'category:')
      const categoryIds = [categoryId, ...(await listChildCategoryIds(categoryId, executor))]
      return selectActiveProductIdsByCategory(categoryIds, executor)
    }
    case 'BRAND': {
      const brandId = scopeKeyValue(scopeKey, 'brand:')
      return selectActiveProductIdsByBrand(brandId, executor)
    }
    case 'ABC_CLASS': {
      const value = scopeKeyValue(scopeKey, 'ABC:')
      if (value !== 'A' && value !== 'B' && value !== 'C') {
        throw new ValidationError('The schedule scope key names an unknown ABC class')
      }
      return selectAbcProductIdsByClass(branchId, value, executor)
    }
    case 'ROTATION': {
      if (scopeKey !== 'ROTATION') {
        throw new ValidationError('A ROTATION schedule has the scope key ROTATION')
      }
      if (!frequency) {
        throw new ValidationError('A ROTATION schedule needs a frequency to size its batch')
      }
      const activeCount = await countBranchActiveProducts(branchId, executor)
      return selectRotationProductIds(branchId, rotationBatchSize(activeCount, frequency), executor)
    }
  }
}

// --- Counts ------------------------------------------------------------------

/** Opens a manual count with a frozen snapshot of the branch level book. */
export async function createCount(
  user: SessionUser,
  actor: AuditActor,
  input: CountCreateInput,
): Promise<CountDetail> {
  const branchRow = await branchesService.getBranch(user, input.branchId)
  if (!branchRow.isActive) throw new ConflictError('The branch is inactive')

  let categoryIds: string[] | null = null
  if (input.categoryId) {
    const name = await findCategoryName(input.categoryId)
    if (!name) throw new NotFoundError('Category not found')
    categoryIds = [input.categoryId, ...(await listChildCategoryIds(input.categoryId))]
  }

  // A category count is catalogue-wide in its subtree, so a part that has never
  // been stocked is still countable (P12-D31). Without a category there is no
  // catalogue enumeration, so the branch's projection rows are the scope.
  const productIds = categoryIds
    ? await selectActiveProductIdsByCategory(categoryIds)
    : await selectStockedProductIds(input.branchId)
  const snapshot = await selectProductsWithLevels(input.branchId, productIds)
  if (snapshot.length === 0) {
    throw new ConflictError('There is no stock to count for this branch and filter')
  }

  const countId = await db.transaction(async (tx) => {
    const number = await allocateFromSequence('inventory.countSequence', tx)
    const created = await insertCount(
      {
        number,
        branchId: input.branchId,
        categoryId: input.categoryId ?? null,
        scope: input.categoryId ? 'CATEGORY' : null,
        scopeKey: input.categoryId ? `category:${input.categoryId}` : null,
        countType: 'MANUAL',
        note: input.note ?? null,
        createdBy: actorLabel(actor),
      },
      tx,
    )
    if (!created) throw new AppError(500, 'INTERNAL', 'Failed to create the stock count')

    await insertCountLines(
      snapshot.map((row) => ({
        countId: created.id,
        productId: row.productId,
        snapshotQty: row.snapshotQty,
      })),
      tx,
    )

    await writeAudit(
      {
        ...actor,
        action: 'count.created',
        entity: 'stock_count',
        entityId: created.id,
        branchId: input.branchId,
        after: {
          number,
          categoryId: input.categoryId ?? null,
          lines: snapshot.length,
          units: snapshot.reduce((sum, row) => sum + row.snapshotQty, 0),
        },
      },
      tx,
    )
    return created.id
  })

  return loadCountDetail(countId)
}

/** A date-only boundary (midnight UTC = midnight Accra) means the whole day, inclusive. */
function inclusiveEnd(date: Date): Date {
  const isMidnight =
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0
  return isMidnight ? new Date(date.getTime() + 86_400_000 - 1) : date
}

export async function listCounts(
  user: SessionUser,
  query: CountListQuery,
): Promise<{ counts: CountListRow[]; total: number; branchId: string | null }> {
  const branchId = resolveBranchFilter(user, query.branchId ?? null)
  const filters = {
    branchId,
    status: query.status,
    from: query.from,
    to: query.to ? inclusiveEnd(query.to) : undefined,
    limit: query.limit,
    offset: query.offset,
  }
  const [counts, total] = await Promise.all([selectCountPage(filters), countCounts(filters)])
  return { counts, total, branchId }
}

export async function getCount(user: SessionUser, countId: string): Promise<CountDetail> {
  const row = await findCountById(countId)
  if (!row) throw new NotFoundError('Stock count not found')
  assertCountAccess(user, row)
  return loadCountDetail(countId)
}

/** Records counted quantities; uncounted lines stay null and are skipped at post. */
export async function updateCountLines(
  user: SessionUser,
  actor: AuditActor,
  countId: string,
  input: CountLinesUpdateInput,
): Promise<CountDetail> {
  await db.transaction(async (tx) => {
    const count = await findCountByIdForUpdate(countId, tx)
    if (!count) throw new NotFoundError('Stock count not found')
    assertCountAccess(user, count)
    assertOpen(count)

    for (const entry of input.lines) {
      const line = await findCountLine(countId, entry.productId, tx)
      if (!line) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Unknown product in this count')
      }
      await updateCountLine(line.id, entry.countedQty, tx)
    }

    const lines = await selectCountLines(countId, tx)
    const counted = lines.filter((line) => line.countedQty !== null)
    await writeAudit(
      {
        ...actor,
        action: 'count.updated',
        entity: 'stock_count',
        entityId: countId,
        branchId: count.branchId,
        after: {
          countedLines: counted.length,
          varianceUnits: counted.reduce((sum, line) => sum + (line.variance ?? 0), 0),
        },
      },
      tx,
    )
  })

  return loadCountDetail(countId)
}

/** Posts every counted variance as a compensating ledger movement, atomically. */
export async function postCount(
  user: SessionUser,
  actor: AuditActor,
  countId: string,
): Promise<CountDetail> {
  await db.transaction(async (tx) => {
    const count = await findCountByIdForUpdate(countId, tx)
    if (!count) throw new NotFoundError('Stock count not found')
    assertCountAccess(user, count)
    assertOpen(count)

    const lines = await selectCountLines(countId, tx)
    const counted = lines.filter((line) => line.countedQty !== null)
    if (counted.length === 0) {
      throw new ConflictError('There are no counted lines to post')
    }

    const variances = counted.filter((line) => (line.variance ?? 0) !== 0)
    const offenders: string[] = []
    for (const line of variances) {
      const variance = line.variance ?? 0
      if (variance >= 0) continue
      const level = await findLevel(line.productId, count.branchId, tx)
      const current = level?.quantityOnHand ?? 0
      if (current + variance < 0) offenders.push(line.productName)
    }
    if (offenders.length > 0) {
      throw new ConflictError(
        `The count would make stock negative for: ${offenders.join(', ')}. Recount before posting.`,
      )
    }

    const movementCost = new Map<string, number>()
    if (variances.length > 0) {
      const posted = await inventoryService.postMovements(
        actor,
        variances.map((line) => ({
          productId: line.productId,
          branchId: count.branchId,
          type: 'COUNT_VARIANCE' as const,
          quantityDelta: line.variance as number,
          referenceType: 'COUNT' as const,
          referenceId: countId,
          referenceNumber: count.number,
          note: 'Stock count variance',
          productName: line.productName,
        })),
        { executor: tx },
      )
      // The cost the ledger actually carried, so the trigger and the movement
      // use one number (P12-D32).
      for (const movement of posted.movements) {
        movementCost.set(movement.productId, movement.unitCostMinor)
      }
    }

    // Variance trigger: strictly greater than the branch tolerance. A skipped
    // duplicate (an open trigger already exists) is not an error.
    if (variances.length > 0) {
      const tolerance = await getSettingValue(
        'inventory.countVarianceToleranceMinor',
        { branchId: count.branchId },
        tx,
      )
      for (const line of variances) {
        const value = Math.abs(line.variance ?? 0) * (movementCost.get(line.productId) ?? 0)
        if (value > tolerance) {
          await createTriggerCount(count.branchId, line.productId, 'VARIANCE', countId, tx)
        }
      }
    }

    const updated = await updateCountRow(
      countId,
      { status: 'POSTED', postedBy: actorLabel(actor), postedAt: new Date() },
      tx,
    )
    if (!updated) throw new AppError(500, 'INTERNAL', 'Failed to post the count')

    const shortageUnits = variances
      .filter((line) => (line.variance ?? 0) < 0)
      .reduce((sum, line) => sum + Math.abs(line.variance ?? 0), 0)
    const overageUnits = variances
      .filter((line) => (line.variance ?? 0) > 0)
      .reduce((sum, line) => sum + (line.variance ?? 0), 0)

    await writeAudit(
      {
        ...actor,
        action: 'count.posted',
        entity: 'stock_count',
        entityId: countId,
        branchId: count.branchId,
        after: {
          number: count.number,
          postedLines: variances.length,
          shortageUnits,
          overageUnits,
        },
      },
      tx,
    )
  })

  return loadCountDetail(countId)
}

export async function cancelCount(
  user: SessionUser,
  actor: AuditActor,
  countId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const count = await findCountByIdForUpdate(countId, tx)
    if (!count) throw new NotFoundError('Stock count not found')
    assertCountAccess(user, count)
    assertOpen(count)

    const updated = await updateCountRow(
      countId,
      { status: 'CANCELLED', cancelledBy: actorLabel(actor), cancelledAt: new Date() },
      tx,
    )
    if (!updated) throw new AppError(500, 'INTERNAL', 'Failed to cancel the count')

    await writeAudit(
      {
        ...actor,
        action: 'count.cancelled',
        entity: 'stock_count',
        entityId: countId,
        branchId: count.branchId,
        before: { status: count.status },
        after: { status: updated.status },
      },
      tx,
    )
  })
}

// --- Scheduled and trigger counts (P12-D30, D32) -----------------------------

/**
 * Runs `build` in a savepoint and turns the two partial unique indexes into
 * "already exists" — a skipped duplicate is not an error. A savepoint, not a
 * bare try/catch: a failed statement aborts the enclosing transaction, so a
 * caller like `postCount` could not carry on after a duplicate trigger.
 */
async function attemptCount(
  executor: DbExecutor,
  build: (tx: DbExecutor) => Promise<string>,
): Promise<string | null> {
  try {
    return await executor.transaction(build)
  } catch (error) {
    if (isUniqueViolation(error)) {
      const constraint = uniqueViolationConstraint(error)
      if (
        constraint === 'stock_count_open_schedule_unique' ||
        constraint === 'stock_count_open_trigger_unique'
      ) {
        return null
      }
    }
    throw error
  }
}

/**
 * Creates the count a due schedule describes, or `null` when the schedule
 * already has an open count (the worker then skips and does not advance).
 */
export async function createScheduledCount(
  schedule: CountScheduleRow,
  executor: DbExecutor,
): Promise<string | null> {
  const productIds = await resolveScopeProducts(
    schedule.branchId,
    schedule.scope,
    schedule.scopeKey,
    executor,
    schedule.frequency,
  )
  if (productIds.length === 0) return null

  const snapshot = await selectProductsWithLevels(schedule.branchId, productIds, executor)

  return attemptCount(executor, async (tx) => {
    const number = await allocateFromSequence('inventory.countSequence', tx)
    const created = await insertCount(
      {
        number,
        branchId: schedule.branchId,
        categoryId:
          schedule.scope === 'CATEGORY' ? scopeKeyValue(schedule.scopeKey, 'category:') : null,
        countType: 'SCHEDULED',
        scope: schedule.scope,
        scopeKey: schedule.scopeKey,
        dueAt: schedule.nextDueAt,
        assignedTo: schedule.assignedTo,
        scheduleId: schedule.id,
        createdBy: null,
      },
      tx,
    )
    if (!created) throw new AppError(500, 'INTERNAL', 'Failed to create the scheduled count')

    await insertCountLines(
      snapshot.map((row) => ({
        countId: created.id,
        productId: row.productId,
        snapshotQty: row.snapshotQty,
      })),
      tx,
    )

    await writeAudit(
      {
        ...systemActor(),
        action: 'count.created',
        entity: 'stock_count',
        entityId: created.id,
        branchId: schedule.branchId,
        after: {
          number,
          via: 'schedule',
          reason: schedule.scopeKey,
          scheduleId: schedule.id,
          lines: snapshot.length,
          dueAt: schedule.nextDueAt,
        },
      },
      tx,
    )
    return created.id
  })
}

/**
 * Raises one trigger count for a product. `dueAt` is a week out; the partial
 * unique `(branch_id, trigger_product_id) WHERE status = 'OPEN'` makes a repeat
 * scan a no-op rather than a second count (P12-D30, D32).
 */
export async function createTriggerCount(
  branchId: string,
  productId: string,
  reason: CountTriggerReason,
  sourceId: string | null,
  executor: DbExecutor,
): Promise<string | null> {
  const snapshot = await selectProductsWithLevels(branchId, [productId], executor)
  const snapshotQty = snapshot[0]?.snapshotQty ?? 0
  const dueAt = advanceDueDate(accraIsoDay(), 'WEEKLY')

  return attemptCount(executor, async (tx) => {
    const number = await allocateFromSequence('inventory.countSequence', tx)
    const created = await insertCount(
      {
        number,
        branchId,
        countType: 'TRIGGER',
        triggerReason: reason,
        triggerProductId: productId,
        triggerSourceId: sourceId,
        dueAt,
        createdBy: null,
      },
      tx,
    )
    if (!created) throw new AppError(500, 'INTERNAL', 'Failed to create the trigger count')

    await insertCountLines([{ countId: created.id, productId, snapshotQty }], tx)

    await writeAudit(
      {
        ...systemActor(),
        action: 'count.created',
        entity: 'stock_count',
        entityId: created.id,
        branchId,
        after: { number, via: 'trigger', reason, productId, sourceId, snapshotQty },
      },
      tx,
    )
    return created.id
  })
}

// --- Schedules (P12-D28) -----------------------------------------------------

/** Derives the one scope key P12-D28 stores, and proves its target exists. */
async function resolveScheduleScope(
  input: CountScheduleCreateInput,
): Promise<{ scopeKey: string; categoryId: string | null }> {
  switch (input.scope) {
    case 'CATEGORY': {
      if (!input.categoryId) {
        throw new ValidationError('categoryId is required for a CATEGORY schedule')
      }
      const name = await findCategoryName(input.categoryId)
      if (!name) throw new NotFoundError('Category not found')
      return { scopeKey: `category:${input.categoryId}`, categoryId: input.categoryId }
    }
    case 'BRAND': {
      if (!input.brandId) throw new ValidationError('brandId is required for a BRAND schedule')
      const brandRow = await findBrandById(input.brandId)
      if (!brandRow) throw new NotFoundError('Brand not found')
      if (!brandRow.isActive) throw new ConflictError('The brand is archived')
      return { scopeKey: `brand:${input.brandId}`, categoryId: null }
    }
    case 'ABC_CLASS': {
      if (!input.abcClass) {
        throw new ValidationError('abcClass is required for an ABC_CLASS schedule')
      }
      return { scopeKey: `ABC:${input.abcClass}`, categoryId: null }
    }
    case 'ROTATION':
      return { scopeKey: 'ROTATION', categoryId: null }
  }
}

async function requireScheduleBranch(
  user: SessionUser,
  requestedBranchId: string | undefined,
): Promise<{ branchId: string; isActive: boolean }> {
  const branchId = resolveBranchFilter(user, requestedBranchId ?? null)
  if (!branchId) throw new ValidationError('branchId is required')
  const branchRow = await branchesService.getBranch(user, branchId)
  return { branchId, isActive: branchRow.isActive }
}

export async function createCountSchedule(
  user: SessionUser,
  actor: AuditActor,
  input: CountScheduleCreateInput,
): Promise<CountScheduleRow> {
  const { scopeKey } = await resolveScheduleScope(input)
  const branch = await requireScheduleBranch(user, input.branchId)
  if (!branch.isActive) throw new ConflictError('The branch is inactive')

  // The first count is one period out, never instantly.
  const nextDueAt = input.firstDueAt ?? advanceDueDate(accraIsoDay(), input.frequency)

  return db.transaction(async (tx) => {
    let created: CountScheduleRow | null
    try {
      created = await insertSchedule(
        {
          branchId: branch.branchId,
          scope: input.scope,
          scopeKey,
          frequency: input.frequency,
          nextDueAt,
          assignedTo: input.assignedTo ?? null,
          createdBy: actorLabel(actor),
        },
        tx,
      )
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('A schedule for this scope already exists in the branch')
      }
      throw error
    }
    if (!created) throw new AppError(500, 'INTERNAL', 'Failed to create the count schedule')

    await writeAudit(
      {
        ...actor,
        action: 'count.schedule_created',
        entity: 'count_schedule',
        entityId: created.id,
        branchId: branch.branchId,
        after: {
          scope: created.scope,
          scopeKey: created.scopeKey,
          frequency: created.frequency,
          nextDueAt: created.nextDueAt,
          assignedTo: created.assignedTo,
        },
      },
      tx,
    )
    return created
  })
}

export async function listCountSchedules(
  user: SessionUser,
  query: CountScheduleListQuery,
): Promise<{ schedules: CountScheduleRow[]; total: number; branchId: string | null }> {
  const branchId = resolveBranchFilter(user, query.branchId ?? null)
  const filters: CountScheduleFilters = {
    branchId,
    active: query.active,
    limit: query.limit,
    offset: query.offset,
  }
  const [schedules, total] = await Promise.all([
    selectSchedulePage(filters),
    countSchedules(filters),
  ])
  return { schedules, total, branchId }
}

/**
 * Changes a schedule in place. The scope is immutable: a different scope is a
 * different schedule, and the unique `(branch_id, scope_key)` would reject it
 * anyway. Deactivation is `isActive: false` — a schedule that ran is history,
 * so there is no delete.
 */
export async function updateCountSchedule(
  user: SessionUser,
  actor: AuditActor,
  id: string,
  input: CountScheduleUpdateInput,
): Promise<CountScheduleRow> {
  return db.transaction(async (tx) => {
    const schedule = await findScheduleByIdForUpdate(id, tx)
    if (!schedule) throw new NotFoundError('Count schedule not found')
    assertBranchAccess(user, schedule.branchId)

    const patch: Partial<typeof schedule> = {}
    if (input.frequency !== undefined) patch.frequency = input.frequency
    if (input.nextDueAt !== undefined) patch.nextDueAt = input.nextDueAt
    if (input.assignedTo !== undefined) patch.assignedTo = input.assignedTo
    if (input.isActive !== undefined) patch.isActive = input.isActive

    const branchRow = await branchesService.getBranch(user, schedule.branchId)
    if (!branchRow.isActive && !(input.isActive === false && Object.keys(patch).length === 1)) {
      throw new ConflictError('The branch is inactive')
    }

    const updated = await updateScheduleRow(id, patch, tx)
    if (!updated) throw new AppError(500, 'INTERNAL', 'Failed to update the count schedule')

    await writeAudit(
      {
        ...actor,
        action: 'count.schedule_updated',
        entity: 'count_schedule',
        entityId: id,
        branchId: schedule.branchId,
        before: {
          frequency: schedule.frequency,
          nextDueAt: schedule.nextDueAt,
          assignedTo: schedule.assignedTo,
          isActive: schedule.isActive,
        },
        after: {
          frequency: updated.frequency,
          nextDueAt: updated.nextDueAt,
          assignedTo: updated.assignedTo,
          isActive: updated.isActive,
        },
      },
      tx,
    )
    return updated
  })
}

// --- ABC classes (P12-D29) ---------------------------------------------------

/** The window the ABC ranking treats as "what moves" (P12-D29). */
const ABC_SOLD_WINDOW_DAYS = 90
const DAY_MS = 86_400_000

/**
 * Derives one branch's classes from stock at risk plus 90-day ex-tax sales.
 * Manual rows are skipped and counted, so the caller can say how much of the
 * branch is on an override. One transaction per branch.
 */
export async function recomputeAbcClasses(
  branchId: string,
  executor: DbExecutor = db,
): Promise<AbcRecomputeResult> {
  const run = async (tx: DbExecutor): Promise<AbcRecomputeResult> => {
    const aThresholdBp = await getSettingValue('inventory.abcAThresholdBp', {}, tx)
    const bThresholdBp = await getSettingValue('inventory.abcBThresholdBp', {}, tx)
    const now = new Date()
    const since = new Date(now.getTime() - ABC_SOLD_WINDOW_DAYS * DAY_MS)
    const soldByProduct = await posService.sumSoldValueByProduct(branchId, since, now, tx)
    return recomputeAbcRows(branchId, { aThresholdBp, bThresholdBp }, soldByProduct, tx)
  }

  if (executor === db) return db.transaction(run)
  return run(executor)
}

/**
 * The manual recompute route's entry point. Admin-only: managers hold
 * `inventory.threshold` in the permission matrix, but deriving a branch's
 * classes is a company-level decision, not a shop-floor one.
 */
export async function recomputeAbcClassesForUser(
  user: SessionUser,
  requestedBranchId?: string,
): Promise<AbcRecomputeResult> {
  if (roleOf(user) !== 'ADMIN') {
    throw new ForbiddenError('Only an admin can recompute ABC classes')
  }
  const branchId = resolveBranchFilter(user, requestedBranchId ?? null)
  if (!branchId) throw new ValidationError('branchId is required')
  const branchRow = await branchesService.getBranch(user, branchId)
  if (!branchRow.isActive) throw new ConflictError('The branch is inactive')
  return recomputeAbcClasses(branchId)
}

export async function recomputeAllAbcClassesForUser(
  user: SessionUser,
): Promise<{ branches: number; updated: number; skipped: number; failures: number }> {
  if (roleOf(user) !== 'ADMIN') {
    throw new ForbiddenError('Only an admin can recompute ABC classes')
  }
  return recomputeAllAbcClasses()
}

/**
 * Every active branch, for the 03:00 job. One failing branch does not stop the
 * rest.
 */
export async function recomputeAllAbcClasses(): Promise<{
  branches: number
  updated: number
  skipped: number
  failures: number
}> {
  const branchIds = await selectActiveBranchIds()
  let updated = 0
  let skipped = 0
  let failures = 0

  for (const branchId of branchIds) {
    try {
      const result = await recomputeAbcClasses(branchId)
      updated += result.updated
      skipped += result.skipped
    } catch (error) {
      failures += 1
      logger.error({ err: error, branchId }, 'ABC recompute failed for a branch')
    }
  }

  return { branches: branchIds.length, updated, skipped, failures }
}

export async function listAbcClasses(
  user: SessionUser,
  query: AbcListQuery,
): Promise<{ classes: AbcRow[]; branchId: string }> {
  const branchId = resolveBranchFilter(user, query.branchId ?? null)
  if (!branchId) throw new ValidationError('branchId is required')
  const classes = await selectAbcRows(branchId, query.abcClass)
  return { classes, branchId }
}

/**
 * Sets a class by hand and flags it manual (P12-D29). Only an admin can: the
 * permission matrix grants managers `inventory.threshold`, so the route's
 * permission check alone is not enough — the role is checked again here.
 */
export async function setAbcClassManually(
  user: SessionUser,
  actor: AuditActor,
  productId: string,
  input: AbcManualInput,
): Promise<void> {
  if (roleOf(user) !== 'ADMIN') {
    throw new ForbiddenError('Only an admin can set an ABC class')
  }
  const branchId = resolveBranchFilter(user, input.branchId ?? null)
  if (!branchId) throw new ValidationError('branchId is required')
  const branchRow = await branchesService.getBranch(user, branchId)
  if (!branchRow.isActive) throw new ConflictError('The branch is inactive')

  const productRow = await findProductById(productId)
  if (!productRow) throw new NotFoundError('Product not found')

  await db.transaction(async (tx) => {
    const before = await findAbcRow(productId, branchId, tx)
    const updatedBy = actorLabel(actor)

    if (before) {
      await updateAbcClassRow(
        productId,
        branchId,
        { class: input.abcClass, isManual: input.manual, updatedBy },
        tx,
      )
    } else {
      // A manual class can exist before the first derivation. Price it from the
      // same two inputs the derivation uses so the row is explainable.
      const now = new Date()
      const level = await findLevelValue(productId, branchId, tx)
      const valueMinor = (level?.quantityOnHand ?? 0) * (level?.avgCostMinor ?? 0)
      const sold = await posService.sumSoldValueByProduct(
        branchId,
        new Date(now.getTime() - ABC_SOLD_WINDOW_DAYS * DAY_MS),
        now,
        tx,
      )
      const soldMinor = sold.get(productId) ?? 0
      await upsertAbcRow(
        {
          productId,
          branchId,
          class: input.abcClass,
          valueMinor,
          soldMinor,
          score: valueMinor + soldMinor,
          computedAt: now,
          isManual: input.manual,
          updatedBy,
        },
        tx,
      )
    }

    await writeAudit(
      {
        ...actor,
        action: 'stock.abc_class_changed',
        entity: 'product',
        entityId: productId,
        branchId,
        before: before ? { class: before.class, isManual: before.isManual } : null,
        after: { class: input.abcClass, isManual: input.manual },
      },
      tx,
    )
  })
}

// --- Accuracy (P12-D33) ------------------------------------------------------

function utcDayStart(value: string): Date {
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) throw new ValidationError('from and to must be ISO dates')
  return parsed
}

export async function getCountAccuracy(
  user: SessionUser,
  query: CountAccuracyQuery,
): Promise<CountAccuracy & { branchId: string | null }> {
  const branchId = resolveBranchFilter(user, query.branchId ?? null)
  const from = utcDayStart(query.from)
  const toExclusive = new Date(utcDayStart(query.to).getTime() + DAY_MS)
  if (from.getTime() >= toExclusive.getTime()) {
    throw new ValidationError('from must be on or before to')
  }

  const accuracy = await selectCountAccuracy(branchId, from, toExclusive)
  return { ...accuracy, branchId }
}

// --- Jobs (P12-D32, D34) -----------------------------------------------------

/**
 * Advances every due schedule by one count.
 *
 * A schedule with an open count is skipped and **not** advanced: the period
 * waits for that count to be posted or cancelled rather than being silently
 * lost. A re-run for the same day therefore creates one count and advances
 * once — `next_due_at` has moved past today, and the partial unique on
 * `(schedule_id)` is the second guard.
 */
export async function runDueCountSchedules(): Promise<{
  created: number
  skipped: number
  failures: number
}> {
  const today = accraIsoDay()
  const due = await selectDueSchedules(today)
  let created = 0
  let skipped = 0
  let failures = 0

  for (const candidate of due) {
    try {
      const outcome = await db.transaction(async (tx) => {
        // Re-read under the row lock so two workers cannot both create.
        const schedule = await findScheduleByIdForUpdate(candidate.id, tx)
        if (!schedule || !schedule.isActive || schedule.nextDueAt > today) return 'skipped'

        const countId = await createScheduledCount(schedule, tx)
        if (!countId) return 'skipped'

        const advanced = await updateScheduleRow(
          schedule.id,
          { nextDueAt: advanceDueDate(schedule.nextDueAt, schedule.frequency) },
          tx,
        )
        if (!advanced) throw new AppError(500, 'INTERNAL', 'Failed to advance the count schedule')
        return 'created'
      })
      if (outcome === 'created') created += 1
      else skipped += 1
    } catch (error) {
      failures += 1
      logger.error({ err: error, scheduleId: candidate.id }, 'count schedule failed')
    }
  }

  return { created, skipped, failures }
}

/**
 * Raises a count for products that oversold at least twice in the window.
 *
 * These two numbers are constants, not settings: a branch that can raise them
 * has no trigger (P12-D32). The scan runs nightly, never inside `applySale` —
 * a failure here must not reject a sale that already happened at the till.
 */
const OVERSELL_WINDOW_DAYS = 30
const OVERSELL_CONFLICT_THRESHOLD = 2

export async function scanOversellTriggers(): Promise<{ candidates: number; raised: number }> {
  const since = new Date(Date.now() - OVERSELL_WINDOW_DAYS * DAY_MS)
  const candidates = await selectOversellConflicts(since, OVERSELL_CONFLICT_THRESHOLD)
  let raised = 0

  for (const candidate of candidates) {
    try {
      const countId = await db.transaction((tx) =>
        createTriggerCount(candidate.branchId, candidate.productId, 'OVERSELL', null, tx),
      )
      if (countId) raised += 1
    } catch (error) {
      logger.error(
        { err: error, branchId: candidate.branchId, productId: candidate.productId },
        'oversell trigger failed',
      )
    }
  }

  return { candidates: candidates.length, raised }
}
