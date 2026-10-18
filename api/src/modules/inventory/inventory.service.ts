import { type DbExecutor, db } from '@gikautos/db'
import { averageCostAfterReceipt } from '@gikautos/shared'
import { assertBranchAccess } from '../../auth/scope.ts'
import { AppError, ConflictError } from '../../http/errors.ts'
import type { SessionUser } from '../../http/factory.ts'
import type { AuditActor } from '../platform/audit.types.ts'
import {
  findLevel,
  insertMovement,
  lockOrCreateLevel,
  selectBranchLevels,
  sumMovementsByProduct,
  sumMovementsForProduct,
  updateLevel,
} from './inventory.repository.ts'
import type {
  BranchReconciliation,
  MovementInput,
  PostMovementsOptions,
  PostMovementsResult,
  StockLevelRow,
} from './inventory.types.ts'

function assertSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new AppError(400, 'VALIDATION_ERROR', `${label} must be a whole number`)
  }
}

function validateInput(input: MovementInput): void {
  assertSafeInteger(input.quantityDelta, 'Quantity')
  if (input.quantityDelta === 0) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Quantity must not be zero')
  }

  const inbound = input.type === 'RECEIPT' || input.type === 'TRANSFER_IN'
  if (inbound) {
    if (input.quantityDelta < 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Inbound movements require a positive quantity')
    }
    if (input.unitCostMinor === undefined) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Inbound movements require a unit cost')
    }
    assertSafeInteger(input.unitCostMinor, 'Unit cost')
    if (input.unitCostMinor < 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Unit cost must not be negative')
    }
  }

  if (input.type === 'TRANSFER_OUT' && input.quantityDelta > 0) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Transfer-out movements require a negative quantity',
    )
  }

  if (input.type === 'ADJUSTMENT' && !input.reasonCode) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Adjustments require a reason code')
  }
}

function insufficientStockMessage(input: MovementInput, level: StockLevelRow): string {
  const label = input.productName ? `"${input.productName}"` : `product ${input.productId}`
  return `Insufficient stock for ${label}: on hand ${level.quantityOnHand}, requested ${-input.quantityDelta}`
}

/**
 * Single writer for the stock ledger. Locks the affected projection rows in
 * deterministic product order, validates the negative guard, re-averages
 * inbound movements, then appends movements and updates levels together.
 *
 * Pass `executor` to enlist in a caller's transaction (receipts, transfers,
 * counts); omit it to run in a transaction of its own.
 */
export async function postMovements(
  actor: AuditActor,
  inputs: readonly MovementInput[],
  options: PostMovementsOptions = {},
): Promise<PostMovementsResult> {
  if (inputs.length === 0) {
    throw new AppError(400, 'VALIDATION_ERROR', 'At least one movement is required')
  }

  const apply = async (executor: DbExecutor): Promise<PostMovementsResult> => {
    const sorted = [...inputs].sort((a, b) => a.productId.localeCompare(b.productId))
    const seen = new Set<string>()
    for (const input of sorted) {
      if (seen.has(input.productId)) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Duplicate product in one posting batch')
      }
      seen.add(input.productId)
      validateInput(input)

      const level = await lockOrCreateLevel(input.productId, input.branchId, executor)
      if (!level) throw new AppError(500, 'INTERNAL', 'Failed to lock the stock level')

      const inbound = input.type === 'RECEIPT' || input.type === 'TRANSFER_IN'
      const quantityOnHand = level.quantityOnHand + input.quantityDelta
      if (quantityOnHand < 0 && !options.allowNegative) {
        throw new ConflictError(insufficientStockMessage(input, level))
      }

      const avgCostMinor = inbound
        ? averageCostAfterReceipt(
            level.avgCostMinor,
            level.quantityOnHand,
            input.unitCostMinor as number,
            input.quantityDelta,
          )
        : level.avgCostMinor
      const unitCostMinor = inbound ? (input.unitCostMinor as number) : level.avgCostMinor

      const updated = await updateLevel(level.id, { quantityOnHand, avgCostMinor }, executor)
      if (!updated) throw new AppError(500, 'INTERNAL', 'Failed to update the stock level')

      const movement = await insertMovement(
        {
          productId: input.productId,
          branchId: input.branchId,
          type: input.type,
          quantityDelta: input.quantityDelta,
          unitCostMinor,
          referenceType: input.referenceType,
          referenceId: input.referenceId ?? null,
          referenceNumber: input.referenceNumber ?? null,
          reasonCode: input.reasonCode ?? null,
          note: input.note ?? null,
          createdBy: actor.actorId,
        },
        executor,
      )
      if (!movement) throw new AppError(500, 'INTERNAL', 'Failed to append the stock movement')

      movements.push(movement)
      levels.set(input.productId, updated)
    }

    return { movements, levels }
  }

  const movements: PostMovementsResult['movements'] = []
  const levels: PostMovementsResult['levels'] = new Map()

  if (options.executor) {
    return apply(options.executor)
  }
  return db.transaction((tx) => apply(tx))
}

/** Reads a projected level, enforcing branch access for managers. */
export async function getLevelForUser(
  user: SessionUser,
  productId: string,
  branchId: string,
): Promise<StockLevelRow | null> {
  assertBranchAccess(user, branchId)
  return findLevel(productId, branchId)
}

/** Total on-hand for a product across all branches, from the ledger itself. */
export async function getOnHandTotal(
  productId: string,
  executor: DbExecutor = db,
): Promise<number> {
  return sumMovementsForProduct(productId, executor)
}

/**
 * Compares every projection row in a branch with the ledger sum. An empty
 * result proves `quantity_on_hand = SUM(quantity_delta)` for that branch.
 */
export async function reconcileBranch(
  branchId: string,
  executor: DbExecutor = db,
): Promise<BranchReconciliation[]> {
  const [levelled, summed] = await Promise.all([
    selectBranchLevels(branchId, executor),
    sumMovementsByProduct(branchId, executor),
  ])

  const quantities = new Map<string, { quantityOnHand: number; ledgerQuantity: number }>()
  for (const level of levelled) {
    quantities.set(level.productId, {
      quantityOnHand: level.quantityOnHand,
      ledgerQuantity: 0,
    })
  }
  for (const row of summed) {
    const entry = quantities.get(row.productId) ?? { quantityOnHand: 0, ledgerQuantity: 0 }
    entry.ledgerQuantity = row.total
    quantities.set(row.productId, entry)
  }

  const discrepancies: BranchReconciliation[] = []
  for (const [productId, entry] of quantities) {
    if (entry.quantityOnHand !== entry.ledgerQuantity) {
      discrepancies.push({ productId, branchId, ...entry })
    }
  }
  return discrepancies
}
