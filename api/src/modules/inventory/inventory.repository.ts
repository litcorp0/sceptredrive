import { type DbExecutor, db } from '@gikautos/db'
import { and, eq, sql } from 'drizzle-orm'
import { stockLevel, stockMovement } from './inventory.schema.ts'
import type { StockLevelRow, StockMovementRow } from './inventory.types.ts'

export interface MovementInsert {
  productId: string
  branchId: string
  type: StockMovementRow['type']
  quantityDelta: number
  unitCostMinor: number
  referenceType: StockMovementRow['referenceType']
  referenceId: string | null
  referenceNumber: string | null
  reasonCode: StockMovementRow['reasonCode']
  note: string | null
  createdBy: string | null
}

/**
 * Appends one movement. There is deliberately no update or delete helper for
 * this table anywhere in the module: the ledger is append-only.
 */
export async function insertMovement(
  input: MovementInsert,
  executor: DbExecutor,
): Promise<StockMovementRow | null> {
  const rows = await executor.insert(stockMovement).values(input).returning()
  return rows[0] ?? null
}

/**
 * Ensures the projection row exists, then locks it for update. Concurrent
 * writers serialize here; the caller reads a true balance after the lock.
 */
export async function lockOrCreateLevel(
  productId: string,
  branchId: string,
  executor: DbExecutor,
): Promise<StockLevelRow | null> {
  await executor
    .insert(stockLevel)
    .values({ productId, branchId })
    .onConflictDoNothing({ target: [stockLevel.productId, stockLevel.branchId] })

  const rows = await executor
    .select()
    .from(stockLevel)
    .where(and(eq(stockLevel.productId, productId), eq(stockLevel.branchId, branchId)))
    .limit(1)
    .for('update')
  return rows[0] ?? null
}

export async function updateLevel(
  id: string,
  patch: { quantityOnHand: number; avgCostMinor: number },
  executor: DbExecutor,
): Promise<StockLevelRow | null> {
  const rows = await executor.update(stockLevel).set(patch).where(eq(stockLevel.id, id)).returning()
  return rows[0] ?? null
}

export async function findLevel(
  productId: string,
  branchId: string,
  executor: DbExecutor = db,
): Promise<StockLevelRow | null> {
  const rows = await executor
    .select()
    .from(stockLevel)
    .where(and(eq(stockLevel.productId, productId), eq(stockLevel.branchId, branchId)))
    .limit(1)
  return rows[0] ?? null
}

export async function selectBranchLevels(
  branchId: string,
  executor: DbExecutor = db,
): Promise<StockLevelRow[]> {
  return executor.select().from(stockLevel).where(eq(stockLevel.branchId, branchId))
}

export async function sumMovementsByProduct(
  branchId: string,
  executor: DbExecutor = db,
): Promise<{ productId: string; total: number }[]> {
  return executor
    .select({
      productId: stockMovement.productId,
      total: sql<number>`coalesce(sum(${stockMovement.quantityDelta}), 0)`.mapWith(Number),
    })
    .from(stockMovement)
    .where(eq(stockMovement.branchId, branchId))
    .groupBy(stockMovement.productId)
}

export async function sumMovementsForProduct(
  productId: string,
  executor: DbExecutor = db,
): Promise<number> {
  const rows = await executor
    .select({
      total: sql<number>`coalesce(sum(${stockMovement.quantityDelta}), 0)`.mapWith(Number),
    })
    .from(stockMovement)
    .where(eq(stockMovement.productId, productId))
  return rows[0]?.total ?? 0
}
