import { type DbExecutor, db } from '@sceptre/db'
import { averageCostAfterReceipt } from '@sceptre/shared'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { assertBranchAccess, resolveBranchFilter } from '../../auth/scope.ts'
import { actorLabel } from '../../http/audit-context.ts'
import { AppError, ConflictError, NotFoundError } from '../../http/errors.ts'
import type { SessionUser } from '../../http/factory.ts'
import * as branchesService from '../org/branches.service.ts'
import { writeAudit } from '../platform/audit.service.ts'
import type { AuditActor } from '../platform/audit.types.ts'
import { allocateFromSequence } from '../platform/settings.service.ts'
import { findProductById } from '../products/products.repository.ts'
import { supplier } from '../suppliers/suppliers.schema.ts'
import { requireSupplier } from '../suppliers/suppliers.service.ts'
import {
  countMovements,
  countReceipts,
  countStockRows,
  deleteThresholdRow,
  findLevel,
  findReceiptBase,
  findStockProduct,
  findThreshold,
  insertMovement,
  insertReceipt,
  insertReceiptLine,
  lockOrCreateLevel,
  selectBranchLevels,
  selectMovementPage,
  selectReceiptLines,
  selectReceiptPage,
  selectStockPage,
  selectThresholdRows,
  sumMovementsByProduct,
  sumMovementsForProduct,
  updateDerivedCost,
  updateLevel,
  upsertThresholdRow,
} from './inventory.repository.ts'
import { stockReceipt } from './inventory.schema.ts'
import type {
  AdjustmentCreateInput,
  BranchReconciliation,
  MovementHistoryRow,
  MovementInput,
  MovementListQuery,
  PostMovementsOptions,
  PostMovementsResult,
  ReceiptCreateInput,
  ReceiptDetail,
  ReceiptForPayables,
  ReceiptListQuery,
  StockDetail,
  StockLevelRow,
  StockListQuery,
  StockReceiptRow,
  StockRow,
  ThresholdInput,
  ThresholdRow,
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

  // An outbound caller may pin the cost it approved (a write-off posts the cost
  // frozen at request time, P12-D17). Without one the projection's average is
  // the cost basis, which is what every Phase 1–11 outbound path relies on.
  if (!inbound && input.unitCostMinor !== undefined) {
    assertSafeInteger(input.unitCostMinor, 'Unit cost')
    if (input.unitCostMinor < 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Unit cost must not be negative')
    }
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
      const unitCostMinor = inbound
        ? (input.unitCostMinor as number)
        : (input.unitCostMinor ?? level.avgCostMinor)

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
          createdBy: actorLabel(actor),
        },
        executor,
      )
      if (!movement) throw new AppError(500, 'INTERNAL', 'Failed to append the stock movement')

      // Catalogue cost follows the latest goods receipt and nothing else (P11-D13).
      if (input.type === 'RECEIPT') {
        await updateDerivedCost(input.productId, unitCostMinor, executor)
      }

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

async function requireActiveProduct(productId: string, executor: DbExecutor = db) {
  const found = await findProductById(productId, executor)
  if (!found) throw new NotFoundError('Product not found')
  if (!found.isActive) throw new ConflictError('The product is archived')
  return found
}

async function requireActiveBranch(user: SessionUser, branchId: string) {
  const found = await branchesService.getBranch(user, branchId)
  if (!found.isActive) throw new ConflictError('The branch is inactive')
  return found
}

async function loadReceipt(receiptId: string, executor: DbExecutor = db): Promise<ReceiptDetail> {
  const base = await findReceiptBase(receiptId, executor)
  if (!base) throw new NotFoundError('Receipt not found')
  const lines = await selectReceiptLines(receiptId, executor)
  return {
    ...base,
    lineCount: lines.length,
    totalCostMinor: lines.reduce((sum, line) => sum + line.quantity * line.unitCostMinor, 0),
    lines,
  }
}

/**
 * Permission-free receipt view for the payables service (service-to-service
 * seam; authorization stays with the caller, mirroring `requireCustomer`).
 */
export async function loadReceiptForPayables(
  receiptId: string,
  executor: DbExecutor = db,
): Promise<ReceiptForPayables> {
  const base = await findReceiptBase(receiptId, executor)
  if (!base) throw new NotFoundError('Receipt not found')
  const lines = await selectReceiptLines(receiptId, executor)
  return {
    id: base.id,
    number: base.number,
    branchId: base.branchId,
    supplierId: base.supplierId,
    supplierName: base.supplierName,
    supplierInvoiceNumber: base.supplierInvoiceNumber,
    note: base.note,
    lines: lines.map((line) => ({
      productId: line.productId,
      quantity: line.quantity,
      unitCostMinor: line.unitCostMinor,
    })),
  }
}

/**
 * Links a receipt to its supplier when an invoice is raised from it. Sets
 * `supplier_id` and fills the `supplier_name` snapshot when empty; a no-op when
 * the receipt is already linked.
 */
export async function attachReceiptSupplier(
  receiptId: string,
  supplierId: string,
  executor: DbExecutor = db,
): Promise<void> {
  await executor
    .update(stockReceipt)
    .set({
      supplierId,
      supplierName: sql`coalesce(${stockReceipt.supplierName}, (select ${supplier.name} from ${supplier} where ${supplier.id} = ${supplierId}))`,
    })
    .where(and(eq(stockReceipt.id, receiptId), isNull(stockReceipt.supplierId)))
}

/** Creates an immutable goods receipt and posts its movements atomically. */
export async function createReceipt(
  user: SessionUser,
  actor: AuditActor,
  input: ReceiptCreateInput,
  options: { executor?: DbExecutor } = {},
): Promise<ReceiptDetail> {
  await requireActiveBranch(user, input.branchId)
  const supplier = input.supplierId ? await requireSupplier(input.supplierId) : null

  const productNames = new Map<string, string>()
  for (const line of input.lines) {
    const found = await requireActiveProduct(line.productId)
    productNames.set(line.productId, found.name)
  }

  const run = async (tx: DbExecutor): Promise<string> => {
    const number = await allocateFromSequence('inventory.receiptSequence', tx)
    const receipt = await insertReceipt(
      {
        number,
        branchId: input.branchId,
        supplierId: supplier?.id ?? null,
        supplierName: supplier ? supplier.name : (input.supplierName ?? null),
        supplierInvoiceNumber: input.supplierInvoiceNumber ?? null,
        note: input.note ?? null,
        purchaseOrderId: input.purchaseOrderId ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        createdBy: actorLabel(actor),
      },
      tx,
    )
    if (!receipt) throw new AppError(500, 'INTERNAL', 'Failed to create the receipt')

    const posted = await postMovements(
      actor,
      input.lines.map((line) => ({
        productId: line.productId,
        branchId: input.branchId,
        type: 'RECEIPT' as const,
        quantityDelta: line.quantity,
        unitCostMinor: line.unitCostMinor,
        referenceType: 'RECEIPT' as const,
        referenceId: receipt.id,
        referenceNumber: number,
        productName: productNames.get(line.productId),
      })),
      { executor: tx },
    )

    const movementByProduct = new Map(posted.movements.map((row) => [row.productId, row.id]))
    for (const line of input.lines) {
      const movementId = movementByProduct.get(line.productId)
      if (!movementId) throw new AppError(500, 'INTERNAL', 'Failed to link a receipt line')
      await insertReceiptLine(
        {
          receiptId: receipt.id,
          productId: line.productId,
          quantity: line.quantity,
          unitCostMinor: line.unitCostMinor,
          movementId,
          purchaseOrderLineId: line.purchaseOrderLineId ?? null,
          overReceiptReason: line.overReceiptReason ?? null,
          overReceiptNote: line.overReceiptNote ?? null,
        },
        tx,
      )
    }

    await writeAudit(
      {
        ...actor,
        action: 'stock_receipt.created',
        entity: 'stock_receipt',
        entityId: receipt.id,
        branchId: input.branchId,
        after: {
          number,
          supplierId: supplier?.id ?? null,
          supplierName: supplier ? supplier.name : (input.supplierName ?? null),
          supplierInvoiceNumber: input.supplierInvoiceNumber ?? null,
          lines: input.lines,
        },
      },
      tx,
    )

    return receipt.id
  }

  const receiptId = options.executor ? await run(options.executor) : await db.transaction(run)
  // Read through the caller's transaction when there is one: an uncommitted
  // receipt is invisible to another connection, and this is the caller's fact.
  return loadReceipt(receiptId, options.executor ?? db)
}

export async function listReceipts(
  user: SessionUser,
  query: ReceiptListQuery,
): Promise<{ receipts: StockReceiptRow[]; total: number; branchId: string | null }> {
  const branchId = resolveBranchFilter(user, query.branchId ?? null)
  const filters = {
    branchId,
    purchaseOrderId: query.purchaseOrderId,
    from: query.from,
    to: query.to,
    limit: query.limit,
    offset: query.offset,
  }
  const [receipts, total] = await Promise.all([selectReceiptPage(filters), countReceipts(filters)])
  return { receipts, total, branchId }
}

export async function getReceipt(user: SessionUser, receiptId: string): Promise<ReceiptDetail> {
  const detail = await loadReceipt(receiptId)
  assertBranchAccess(user, detail.branchId)
  return detail
}

/** Posts a reason-coded manual adjustment and audits the level change. */
export async function createAdjustment(
  user: SessionUser,
  actor: AuditActor,
  input: AdjustmentCreateInput,
): Promise<{ movement: PostMovementsResult['movements'][number]; level: StockLevelRow }> {
  await requireActiveBranch(user, input.branchId)
  await requireActiveProduct(input.productId)

  return db.transaction(async (tx) => {
    const before = await findLevel(input.productId, input.branchId, tx)
    const posted = await postMovements(
      actor,
      [
        {
          productId: input.productId,
          branchId: input.branchId,
          type: 'ADJUSTMENT',
          quantityDelta: input.quantityDelta,
          referenceType: 'ADJUSTMENT',
          reasonCode: input.reasonCode,
          note: input.note ?? null,
        },
      ],
      { executor: tx },
    )

    const movement = posted.movements[0]
    const level = posted.levels.get(input.productId)
    if (!movement || !level) throw new AppError(500, 'INTERNAL', 'Failed to post the adjustment')

    await writeAudit(
      {
        ...actor,
        action: 'stock.adjusted',
        entity: 'product',
        entityId: input.productId,
        branchId: input.branchId,
        before: {
          quantityOnHand: before?.quantityOnHand ?? 0,
          avgCostMinor: before?.avgCostMinor ?? 0,
        },
        after: {
          quantityOnHand: level.quantityOnHand,
          avgCostMinor: level.avgCostMinor,
          quantityDelta: input.quantityDelta,
          reasonCode: input.reasonCode,
          note: input.note ?? null,
        },
      },
      tx,
    )

    return { movement, level }
  })
}

export async function listMovements(
  user: SessionUser,
  query: MovementListQuery,
): Promise<{ movements: MovementHistoryRow[]; total: number; branchId: string | null }> {
  const branchId = resolveBranchFilter(user, query.branchId ?? null)
  const filters = {
    branchId,
    productId: query.productId,
    type: query.type,
    from: query.from,
    to: query.to,
    limit: query.limit,
    offset: query.offset,
  }
  const [movements, total] = await Promise.all([
    selectMovementPage(filters),
    countMovements(filters),
  ])
  return { movements, total, branchId }
}

function toStockRow(row: {
  productId: string
  sku: string
  productName: string
  categoryName: string
  quantityOnHand: number
  avgCostMinor: number
  threshold: number | null
  updatedAt: Date
}): StockRow {
  return {
    ...row,
    valueMinor: row.quantityOnHand * row.avgCostMinor,
    isLow: row.threshold !== null && row.quantityOnHand <= row.threshold,
  }
}

async function queryStock(
  user: SessionUser,
  query: StockListQuery,
  forceLowStock: boolean,
): Promise<{ stock: StockRow[]; total: number; branchId: string }> {
  const branchId = resolveBranchFilter(user, query.branchId ?? null)
  if (!branchId) {
    throw new AppError(400, 'VALIDATION_ERROR', 'branchId is required')
  }

  const filters = {
    branchId,
    q: query.q,
    lowStock: forceLowStock || query.lowStock === true,
    limit: query.limit,
    offset: query.offset,
  }
  const [rows, total] = await Promise.all([selectStockPage(filters), countStockRows(filters)])
  return { stock: rows.map(toStockRow), total, branchId }
}

export async function listStock(
  user: SessionUser,
  query: StockListQuery,
): Promise<{ stock: StockRow[]; total: number; branchId: string }> {
  return queryStock(user, query, false)
}

export async function listLowStock(
  user: SessionUser,
  query: StockListQuery,
): Promise<{ stock: StockRow[]; total: number; branchId: string }> {
  return queryStock(user, query, true)
}

export async function getStockDetail(
  user: SessionUser,
  productId: string,
  requestedBranchId?: string | null,
): Promise<StockDetail> {
  const branchId = resolveBranchFilter(user, requestedBranchId ?? null)
  if (!branchId) {
    throw new AppError(400, 'VALIDATION_ERROR', 'branchId is required')
  }

  const productRow = await findStockProduct(productId)
  if (!productRow) throw new NotFoundError('Product not found')

  const [level, threshold] = await Promise.all([
    findLevel(productId, branchId),
    findThreshold(productId, branchId),
  ])

  const quantityOnHand = level?.quantityOnHand ?? 0
  const avgCostMinor = level?.avgCostMinor ?? 0
  return {
    ...productRow,
    quantityOnHand,
    avgCostMinor,
    valueMinor: quantityOnHand * avgCostMinor,
    threshold: threshold?.threshold ?? null,
    updatedAt: level?.updatedAt ?? null,
  }
}

export async function listThresholds(
  user: SessionUser,
  requestedBranchId?: string | null,
): Promise<{ thresholds: ThresholdRow[]; branchId: string }> {
  const branchId = resolveBranchFilter(user, requestedBranchId ?? null)
  if (!branchId) {
    throw new AppError(400, 'VALIDATION_ERROR', 'branchId is required')
  }
  return { thresholds: await selectThresholdRows(branchId), branchId }
}

export async function setThreshold(
  user: SessionUser,
  actor: AuditActor,
  input: ThresholdInput,
): Promise<{
  id: string
  productId: string
  branchId: string
  threshold: number
  maxQuantity: number | null
  minOrderQuantity: number
}> {
  await requireActiveBranch(user, input.branchId)
  await requireActiveProduct(input.productId)

  return db.transaction(async (tx) => {
    const existing = await findThreshold(input.productId, input.branchId, tx)

    // P11-D3: an omitted field keeps what is stored; a new row tops up to twice
    // its reorder point, which is the backfill rule the migration applied.
    const maxQuantity =
      input.maxQuantity !== undefined
        ? input.maxQuantity
        : existing
          ? existing.maxQuantity
          : input.threshold * 2
    const minOrderQuantity =
      input.minOrderQuantity !== undefined
        ? input.minOrderQuantity
        : (existing?.minOrderQuantity ?? 0)

    const saved = await upsertThresholdRow(
      {
        productId: input.productId,
        branchId: input.branchId,
        threshold: input.threshold,
        maxQuantity,
        minOrderQuantity,
        updatedBy: actor.actorId,
      },
      tx,
    )
    if (!saved) throw new AppError(500, 'INTERNAL', 'Failed to save the threshold')

    await writeAudit(
      {
        ...actor,
        action: 'stock_threshold.updated',
        entity: 'stock_threshold',
        entityId: saved.id,
        branchId: input.branchId,
        before: existing
          ? {
              threshold: existing.threshold,
              maxQuantity: existing.maxQuantity,
              minOrderQuantity: existing.minOrderQuantity,
            }
          : null,
        after: {
          productId: input.productId,
          threshold: saved.threshold,
          maxQuantity: saved.maxQuantity,
          minOrderQuantity: saved.minOrderQuantity,
        },
      },
      tx,
    )

    return {
      id: saved.id,
      productId: input.productId,
      branchId: input.branchId,
      threshold: saved.threshold,
      maxQuantity: saved.maxQuantity,
      minOrderQuantity: saved.minOrderQuantity,
    }
  })
}

export async function removeThreshold(
  user: SessionUser,
  actor: AuditActor,
  productId: string,
  requestedBranchId?: string | null,
): Promise<void> {
  const branchId = resolveBranchFilter(user, requestedBranchId ?? null)
  if (!branchId) {
    throw new AppError(400, 'VALIDATION_ERROR', 'branchId is required')
  }

  const existing = await findThreshold(productId, branchId)
  if (!existing) throw new NotFoundError('Threshold not found')

  await db.transaction(async (tx) => {
    await deleteThresholdRow(existing.id, tx)
    await writeAudit(
      {
        ...actor,
        action: 'stock_threshold.removed',
        entity: 'stock_threshold',
        entityId: existing.id,
        branchId,
        before: { productId, threshold: existing.threshold },
        after: null,
      },
      tx,
    )
  })
}
