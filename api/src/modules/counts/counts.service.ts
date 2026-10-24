import { db } from '@sceptre/db'
import { assertBranchAccess, resolveBranchFilter } from '../../auth/scope.ts'
import { actorLabel } from '../../http/audit-context.ts'
import { AppError, ConflictError, NotFoundError } from '../../http/errors.ts'
import type { SessionUser } from '../../http/factory.ts'
import { listChildCategoryIds } from '../catalog/catalog.repository.ts'
import { findLevel } from '../inventory/inventory.repository.ts'
import * as inventoryService from '../inventory/inventory.service.ts'
import * as branchesService from '../org/branches.service.ts'
import { writeAudit } from '../platform/audit.service.ts'
import type { AuditActor } from '../platform/audit.types.ts'
import { allocateFromSequence } from '../platform/settings.service.ts'
import {
  countCounts,
  findCategoryName,
  findCountById,
  findCountByIdForUpdate,
  findCountLine,
  insertCount,
  insertCountLines,
  selectCountBase,
  selectCountLines,
  selectCountPage,
  selectSnapshotRows,
  updateCountLine,
  updateCountRow,
} from './counts.repository.ts'
import type {
  CountCreateInput,
  CountDetail,
  CountLinesUpdateInput,
  CountListQuery,
  CountListRow,
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

/** Opens a count with a frozen snapshot of the branch level book. */
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

  const snapshot = await selectSnapshotRows(input.branchId, categoryIds)
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
        snapshotQty: row.quantityOnHand,
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
          units: snapshot.reduce((sum, row) => sum + row.quantityOnHand, 0),
        },
      },
      tx,
    )
    return created.id
  })

  return loadCountDetail(countId)
}

export async function listCounts(
  user: SessionUser,
  query: CountListQuery,
): Promise<{ counts: CountListRow[]; total: number; branchId: string | null }> {
  const branchId = resolveBranchFilter(user, query.branchId ?? null)
  const filters = {
    branchId,
    status: query.status,
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

    if (variances.length > 0) {
      await inventoryService.postMovements(
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
