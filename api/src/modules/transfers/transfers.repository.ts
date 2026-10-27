import { type DbExecutor, db } from '@sceptre/db'
import { and, count, desc, eq, gte, inArray, lte, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { stockLevel } from '../inventory/inventory.schema.ts'
import { branch } from '../org/branches.schema.ts'
import { product } from '../products/products.schema.ts'
import { transfer, transferLine } from './transfers.schema.ts'
import type {
  LevelSnapshot,
  TransferLineDetail,
  TransferLineRow,
  TransferListFilters,
  TransferListRow,
  TransferRow,
} from './transfers.types.ts'

const fromBranch = alias(branch, 'from_branch')
const toBranch = alias(branch, 'to_branch')

export async function insertTransfer(
  values: {
    number: string
    fromBranchId: string
    toBranchId: string
    status: 'DRAFT' | 'REQUESTED'
    note: string | null
    createdBy: string | null
  },
  executor: DbExecutor,
): Promise<TransferRow | null> {
  const rows = await executor.insert(transfer).values(values).returning()
  return rows[0] ?? null
}

export async function insertTransferLines(
  values: {
    transferId: string
    productId: string
    quantityRequested: number
  }[],
  executor: DbExecutor,
): Promise<void> {
  if (values.length === 0) return
  await executor.insert(transferLine).values(values)
}

export async function findTransferById(
  id: string,
  executor: DbExecutor = db,
): Promise<TransferRow | null> {
  const rows = await executor.select().from(transfer).where(eq(transfer.id, id)).limit(1)
  return rows[0] ?? null
}

export async function findTransferByIdForUpdate(
  id: string,
  executor: DbExecutor,
): Promise<TransferRow | null> {
  const rows = await executor
    .select()
    .from(transfer)
    .where(eq(transfer.id, id))
    .limit(1)
    .for('update')
  return rows[0] ?? null
}

export async function updateTransferRow(
  id: string,
  patch: Partial<typeof transfer.$inferInsert>,
  executor: DbExecutor,
): Promise<TransferRow | null> {
  const rows = await executor.update(transfer).set(patch).where(eq(transfer.id, id)).returning()
  return rows[0] ?? null
}

export async function selectTransferLines(
  transferId: string,
  executor: DbExecutor = db,
): Promise<TransferLineRow[]> {
  return executor
    .select()
    .from(transferLine)
    .where(eq(transferLine.transferId, transferId))
    .orderBy(transferLine.productId)
}

export async function selectTransferLineDetails(
  transferId: string,
  executor: DbExecutor = db,
): Promise<Omit<TransferLineDetail, 'fromOnHand' | 'toOnHand'>[]> {
  const rows = await executor
    .select({
      id: transferLine.id,
      transferId: transferLine.transferId,
      productId: transferLine.productId,
      quantityRequested: transferLine.quantityRequested,
      quantityDispatched: transferLine.quantityDispatched,
      quantityReceived: transferLine.quantityReceived,
      unitCostMinor: transferLine.unitCostMinor,
      sku: product.sku,
      productName: product.name,
    })
    .from(transferLine)
    .innerJoin(product, eq(product.id, transferLine.productId))
    .where(eq(transferLine.transferId, transferId))
    .orderBy(product.name)

  return rows.map((row) => ({
    ...row,
    pending: row.quantityDispatched - row.quantityReceived,
  }))
}

export async function findTransferLine(
  transferId: string,
  productId: string,
  executor: DbExecutor = db,
): Promise<TransferLineRow | null> {
  const rows = await executor
    .select()
    .from(transferLine)
    .where(and(eq(transferLine.transferId, transferId), eq(transferLine.productId, productId)))
    .limit(1)
  return rows[0] ?? null
}

export async function updateTransferLine(
  id: string,
  patch: Partial<typeof transferLine.$inferInsert>,
  executor: DbExecutor,
): Promise<TransferLineRow | null> {
  const rows = await executor
    .update(transferLine)
    .set(patch)
    .where(eq(transferLine.id, id))
    .returning()
  return rows[0] ?? null
}

export async function deleteTransferLines(transferId: string, executor: DbExecutor): Promise<void> {
  await executor.delete(transferLine).where(eq(transferLine.transferId, transferId))
}

function transferConditions(filters: TransferListFilters) {
  const conditions = []
  if (filters.branchId) {
    const branchId = filters.branchId
    if (filters.direction === 'from') {
      conditions.push(eq(transfer.fromBranchId, branchId))
    } else if (filters.direction === 'to') {
      conditions.push(eq(transfer.toBranchId, branchId))
    } else {
      const side = or(eq(transfer.fromBranchId, branchId), eq(transfer.toBranchId, branchId))
      if (side) conditions.push(side)
    }
  }
  if (filters.status) conditions.push(eq(transfer.status, filters.status))
  // A period is about dispatch: a DRAFT has not left the building yet.
  if (filters.from) conditions.push(gte(transfer.dispatchedAt, filters.from))
  if (filters.to) conditions.push(lte(transfer.dispatchedAt, filters.to))
  return conditions
}

const transferSelection = {
  id: transfer.id,
  number: transfer.number,
  fromBranchId: transfer.fromBranchId,
  fromBranchCode: fromBranch.code,
  fromBranchName: fromBranch.name,
  toBranchId: transfer.toBranchId,
  toBranchCode: toBranch.code,
  toBranchName: toBranch.name,
  status: transfer.status,
  note: transfer.note,
  createdBy: transfer.createdBy,
  dispatchedBy: transfer.dispatchedBy,
  dispatchedAt: transfer.dispatchedAt,
  receivedBy: transfer.receivedBy,
  receivedAt: transfer.receivedAt,
  closedBy: transfer.closedBy,
  closedAt: transfer.closedAt,
  cancelledBy: transfer.cancelledBy,
  cancelledAt: transfer.cancelledAt,
  createdAt: transfer.createdAt,
  updatedAt: transfer.updatedAt,
}

export async function selectTransferPage(
  filters: TransferListFilters,
  executor: DbExecutor = db,
): Promise<TransferListRow[]> {
  return executor
    .select({
      ...transferSelection,
      lineCount: sql<number>`count(${transferLine.id})`.mapWith(Number),
      unitsDispatched: sql<number>`coalesce(sum(${transferLine.quantityDispatched}), 0)`.mapWith(
        Number,
      ),
      unitsReceived: sql<number>`coalesce(sum(${transferLine.quantityReceived}), 0)`.mapWith(
        Number,
      ),
    })
    .from(transfer)
    .innerJoin(fromBranch, eq(fromBranch.id, transfer.fromBranchId))
    .innerJoin(toBranch, eq(toBranch.id, transfer.toBranchId))
    .leftJoin(transferLine, eq(transferLine.transferId, transfer.id))
    .where(and(...transferConditions(filters)))
    .groupBy(transfer.id, fromBranch.code, fromBranch.name, toBranch.code, toBranch.name)
    .orderBy(desc(transfer.createdAt))
    .limit(filters.limit)
    .offset(filters.offset)
}

export async function countTransfers(
  filters: TransferListFilters,
  executor: DbExecutor = db,
): Promise<number> {
  const rows = await executor
    .select({ total: count() })
    .from(transfer)
    .where(and(...transferConditions(filters)))
  return rows[0]?.total ?? 0
}

export async function selectTransferBase(
  id: string,
  executor: DbExecutor = db,
): Promise<TransferListRow | null> {
  const rows = await executor
    .select({
      ...transferSelection,
      lineCount: sql<number>`0`.mapWith(Number),
      unitsDispatched: sql<number>`0`.mapWith(Number),
      unitsReceived: sql<number>`0`.mapWith(Number),
    })
    .from(transfer)
    .innerJoin(fromBranch, eq(fromBranch.id, transfer.fromBranchId))
    .innerJoin(toBranch, eq(toBranch.id, transfer.toBranchId))
    .where(eq(transfer.id, id))
    .limit(1)
  return rows[0] ?? null
}

/**
 * The level of every requested product at one branch. One query serves both the
 * detail's on-hand columns and the request valuation, so "the level at a branch"
 * has one definition (P12-D6).
 */
export async function selectLevelsForProducts(
  branchId: string,
  productIds: string[],
  executor: DbExecutor = db,
): Promise<Map<string, LevelSnapshot>> {
  if (productIds.length === 0) return new Map()
  const rows = await executor
    .select({
      productId: stockLevel.productId,
      quantityOnHand: stockLevel.quantityOnHand,
      avgCostMinor: stockLevel.avgCostMinor,
    })
    .from(stockLevel)
    .where(and(eq(stockLevel.branchId, branchId), inArray(stockLevel.productId, productIds)))
  return new Map(
    rows.map((row) => [
      row.productId,
      { quantityOnHand: row.quantityOnHand, avgCostMinor: row.avgCostMinor },
    ]),
  )
}
