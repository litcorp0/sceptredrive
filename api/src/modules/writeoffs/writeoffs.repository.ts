import { type DbExecutor, db } from '@sceptre/db'
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm'
import { stockLevel } from '../inventory/inventory.schema.ts'
import { branch } from '../org/branches.schema.ts'
import { product } from '../products/products.schema.ts'
import { stockWriteOff, stockWriteOffLine } from './writeoffs.schema.ts'
import type {
  StockWriteOffReason,
  StockWriteOffStatus,
  WriteOffLevelSnapshot,
  WriteOffLineDetail,
  WriteOffListFilters,
  WriteOffListRow,
  WriteOffRow,
} from './writeoffs.types.ts'

/**
 * Data access for the write-off document. No decisions live here: the service
 * freezes the value, and the approval handler posts the movements.
 *
 * `stock_level` is read here rather than through the inventory module's
 * repository: a module owns its own reads (the replenishment precedent), and the
 * projection is a shared table, not a shared function.
 */

const writeOffSelection = {
  id: stockWriteOff.id,
  number: stockWriteOff.number,
  branchId: stockWriteOff.branchId,
  branchCode: branch.code,
  branchName: branch.name,
  status: stockWriteOff.status,
  note: stockWriteOff.note,
  valueMinor: stockWriteOff.valueMinor,
  approvalId: stockWriteOff.approvalId,
  requestedBy: stockWriteOff.requestedBy,
  postedAt: stockWriteOff.postedAt,
  createdBy: stockWriteOff.createdBy,
  createdAt: stockWriteOff.createdAt,
  updatedAt: stockWriteOff.updatedAt,
  cancelledBy: stockWriteOff.cancelledBy,
  cancelledAt: stockWriteOff.cancelledAt,
}

export async function insertWriteOff(
  values: {
    number: string
    branchId: string
    status: StockWriteOffStatus
    note: string | null
    valueMinor: number
    requestedBy: string
    createdBy: string | null
  },
  executor: DbExecutor,
): Promise<WriteOffRow | null> {
  const rows = await executor.insert(stockWriteOff).values(values).returning()
  return rows[0] ?? null
}

export async function insertWriteOffLines(
  values: {
    writeOffId: string
    productId: string
    quantity: number
    unitCostMinor: number
    reason: StockWriteOffReason
    note: string | null
  }[],
  executor: DbExecutor,
): Promise<void> {
  if (values.length === 0) return
  await executor.insert(stockWriteOffLine).values(values)
}

export async function findWriteOffById(
  id: string,
  executor: DbExecutor = db,
): Promise<WriteOffRow | null> {
  const rows = await executor.select().from(stockWriteOff).where(eq(stockWriteOff.id, id)).limit(1)
  return rows[0] ?? null
}

/** Locks the header for a decision or a cancellation: one transition at a time. */
export async function lockWriteOffForUpdate(
  id: string,
  executor: DbExecutor,
): Promise<WriteOffRow | null> {
  const rows = await executor
    .select()
    .from(stockWriteOff)
    .where(eq(stockWriteOff.id, id))
    .limit(1)
    .for('update')
  return rows[0] ?? null
}

export async function updateWriteOffRow(
  id: string,
  patch: Partial<typeof stockWriteOff.$inferInsert>,
  executor: DbExecutor,
): Promise<WriteOffRow | null> {
  const rows = await executor
    .update(stockWriteOff)
    .set(patch)
    .where(eq(stockWriteOff.id, id))
    .returning()
  return rows[0] ?? null
}

/**
 * The document's lines with their product labels, ordered by product name so a
 * detail read and a posting batch always present the same order.
 */
export async function selectWriteOffLines(
  writeOffId: string,
  executor: DbExecutor = db,
): Promise<WriteOffLineDetail[]> {
  return executor
    .select({
      id: stockWriteOffLine.id,
      writeOffId: stockWriteOffLine.writeOffId,
      productId: stockWriteOffLine.productId,
      quantity: stockWriteOffLine.quantity,
      unitCostMinor: stockWriteOffLine.unitCostMinor,
      reason: stockWriteOffLine.reason,
      note: stockWriteOffLine.note,
      sku: product.sku,
      productName: product.name,
    })
    .from(stockWriteOffLine)
    .innerJoin(product, eq(product.id, stockWriteOffLine.productId))
    .where(eq(stockWriteOffLine.writeOffId, writeOffId))
    .orderBy(product.name)
}

/**
 * The branch's level for each requested product, including the average cost the
 * request freezes into the line. A missing entry means the branch has never held
 * the product: it values at zero and the decision refuses on stock.
 */
export async function selectWriteOffLinesForValue(
  branchId: string,
  productIds: string[],
  executor: DbExecutor = db,
): Promise<Map<string, WriteOffLevelSnapshot>> {
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

function writeOffConditions(filters: WriteOffListFilters) {
  const conditions = []
  if (filters.branchId) conditions.push(eq(stockWriteOff.branchId, filters.branchId))
  if (filters.status) conditions.push(eq(stockWriteOff.status, filters.status))
  return conditions
}

export async function selectWriteOffPage(
  filters: WriteOffListFilters,
  executor: DbExecutor = db,
): Promise<WriteOffListRow[]> {
  return executor
    .select({
      ...writeOffSelection,
      lineCount: sql<number>`count(${stockWriteOffLine.id})`.mapWith(Number),
    })
    .from(stockWriteOff)
    .innerJoin(branch, eq(branch.id, stockWriteOff.branchId))
    .leftJoin(stockWriteOffLine, eq(stockWriteOffLine.writeOffId, stockWriteOff.id))
    .where(and(...writeOffConditions(filters)))
    .groupBy(stockWriteOff.id, branch.code, branch.name)
    .orderBy(desc(stockWriteOff.createdAt), desc(stockWriteOff.id))
    .limit(filters.limit)
    .offset(filters.offset)
}

export async function countWriteOffs(
  filters: WriteOffListFilters,
  executor: DbExecutor = db,
): Promise<number> {
  const rows = await executor
    .select({ total: count() })
    .from(stockWriteOff)
    .where(and(...writeOffConditions(filters)))
  return Number(rows[0]?.total ?? 0)
}

/** One header with its branch labels and line count, for a detail read. */
export async function selectWriteOffBase(
  id: string,
  executor: DbExecutor = db,
): Promise<WriteOffListRow | null> {
  const rows = await executor
    .select({
      ...writeOffSelection,
      lineCount: sql<number>`count(${stockWriteOffLine.id})`.mapWith(Number),
    })
    .from(stockWriteOff)
    .innerJoin(branch, eq(branch.id, stockWriteOff.branchId))
    .leftJoin(stockWriteOffLine, eq(stockWriteOffLine.writeOffId, stockWriteOff.id))
    .where(eq(stockWriteOff.id, id))
    .groupBy(stockWriteOff.id, branch.code, branch.name)
    .limit(1)
  return rows[0] ?? null
}
