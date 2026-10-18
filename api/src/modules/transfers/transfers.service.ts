import { type DbExecutor, db } from '@gikautos/db'
import { assertBranchAccess, branchScope, resolveBranchFilter } from '../../auth/scope.ts'
import { AppError, ConflictError, ForbiddenError, NotFoundError } from '../../http/errors.ts'
import type { SessionUser } from '../../http/factory.ts'
import * as inventoryService from '../inventory/inventory.service.ts'
import { findBranchById } from '../org/branches.repository.ts'
import { writeAudit } from '../platform/audit.service.ts'
import type { AuditActor } from '../platform/audit.types.ts'
import { allocateFromSequence } from '../platform/settings.service.ts'
import { findProductById } from '../products/products.repository.ts'
import {
  countTransfers,
  deleteTransferLines,
  findTransferById,
  findTransferByIdForUpdate,
  findTransferLine,
  insertTransfer,
  insertTransferLines,
  selectTransferBase,
  selectTransferLineDetails,
  selectTransferLines,
  selectTransferPage,
  updateTransferLine,
  updateTransferRow,
} from './transfers.repository.ts'
import type {
  DispatchInput,
  ReceiveInput,
  ShortCloseInput,
  TransferCreateInput,
  TransferDetail,
  TransferLineInput,
  TransferLinesReplaceInput,
  TransferListQuery,
  TransferListRow,
  TransferRow,
  TransferUpdateInput,
} from './transfers.types.ts'

async function requireActiveProduct(productId: string, executor: DbExecutor = db) {
  const found = await findProductById(productId, executor)
  if (!found) throw new NotFoundError('Product not found')
  if (!found.isActive) throw new ConflictError('The product is archived')
  return found
}

function assertTransferAccess(user: SessionUser, row: TransferRow): void {
  const scope = branchScope(user)
  if (scope !== null && row.fromBranchId !== scope && row.toBranchId !== scope) {
    throw new ForbiddenError('You can only access transfers for your branch')
  }
}

function assertDraft(row: TransferRow): void {
  if (row.status !== 'DRAFT') {
    throw new ConflictError('Only draft transfers can be changed')
  }
}

function assertLinesUnique(lines: readonly { productId: string }[]): void {
  if (new Set(lines.map((line) => line.productId)).size !== lines.length) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Each product may appear only once')
  }
}

async function validateLineProducts(
  lines: readonly TransferLineInput[],
  executor: DbExecutor = db,
): Promise<void> {
  for (const line of lines) {
    await requireActiveProduct(line.productId, executor)
  }
}

async function loadTransferDetail(id: string): Promise<TransferDetail> {
  const base = await selectTransferBase(id)
  if (!base) throw new NotFoundError('Transfer not found')
  const lines = await selectTransferLineDetails(id)
  return {
    ...base,
    lineCount: lines.length,
    unitsDispatched: lines.reduce((sum, line) => sum + line.quantityDispatched, 0),
    unitsReceived: lines.reduce((sum, line) => sum + line.quantityReceived, 0),
    lines,
  }
}

/** Creates a draft transfer; either side may belong to the drafting manager. */
export async function createTransfer(
  user: SessionUser,
  actor: AuditActor,
  input: TransferCreateInput,
): Promise<TransferDetail> {
  assertLinesUnique(input.lines)
  const scope = branchScope(user)

  const [from, to] = await Promise.all([
    findBranchById(input.fromBranchId),
    findBranchById(input.toBranchId),
  ])
  if (!from || !to) throw new NotFoundError('Branch not found')
  if (from.id === to.id) {
    throw new ConflictError('Source and destination branches must differ')
  }
  if (!from.isActive || !to.isActive) {
    throw new ConflictError('Cannot transfer stock to or from an inactive branch')
  }
  if (scope !== null && from.id !== scope && to.id !== scope) {
    throw new ForbiddenError('One side of the transfer must be your branch')
  }
  await validateLineProducts(input.lines)

  const transferId = await db.transaction(async (tx) => {
    const number = await allocateFromSequence('inventory.transferSequence', tx)
    const created = await insertTransfer(
      {
        number,
        fromBranchId: from.id,
        toBranchId: to.id,
        note: input.note ?? null,
        createdBy: actor.actorId,
      },
      tx,
    )
    if (!created) throw new AppError(500, 'INTERNAL', 'Failed to create the transfer')

    await insertTransferLines(
      input.lines.map((line) => ({
        transferId: created.id,
        productId: line.productId,
        quantityRequested: line.quantityRequested,
      })),
      tx,
    )

    await writeAudit(
      {
        ...actor,
        action: 'transfer.created',
        entity: 'transfer',
        entityId: created.id,
        branchId: from.id,
        after: {
          number,
          fromBranchId: from.id,
          toBranchId: to.id,
          lines: input.lines,
        },
      },
      tx,
    )
    return created.id
  })

  return loadTransferDetail(transferId)
}

export async function listTransfers(
  user: SessionUser,
  query: TransferListQuery,
): Promise<{ transfers: TransferListRow[]; total: number; branchId: string | null }> {
  const branchId = resolveBranchFilter(user, query.branchId ?? null)
  const filters = {
    branchId,
    status: query.status,
    limit: query.limit,
    offset: query.offset,
  }
  const [transfers, total] = await Promise.all([
    selectTransferPage(filters),
    countTransfers(filters),
  ])
  return { transfers, total, branchId }
}

export async function getTransfer(user: SessionUser, transferId: string): Promise<TransferDetail> {
  const row = await findTransferById(transferId)
  if (!row) throw new NotFoundError('Transfer not found')
  assertTransferAccess(user, row)
  return loadTransferDetail(transferId)
}

export async function updateTransfer(
  user: SessionUser,
  actor: AuditActor,
  transferId: string,
  input: TransferUpdateInput,
): Promise<TransferDetail> {
  await db.transaction(async (tx) => {
    const existing = await findTransferByIdForUpdate(transferId, tx)
    if (!existing) throw new NotFoundError('Transfer not found')
    assertTransferAccess(user, existing)
    assertDraft(existing)

    if (input.note !== undefined && input.note !== existing.note) {
      const updated = await updateTransferRow(transferId, { note: input.note }, tx)
      if (!updated) throw new AppError(500, 'INTERNAL', 'Failed to update the transfer')
      await writeAudit(
        {
          ...actor,
          action: 'transfer.updated',
          entity: 'transfer',
          entityId: transferId,
          branchId: updated.fromBranchId,
          before: { note: existing.note },
          after: { note: updated.note },
        },
        tx,
      )
    }
  })

  return loadTransferDetail(transferId)
}

export async function replaceTransferLines(
  user: SessionUser,
  actor: AuditActor,
  transferId: string,
  input: TransferLinesReplaceInput,
): Promise<TransferDetail> {
  assertLinesUnique(input.lines)
  await validateLineProducts(input.lines)

  await db.transaction(async (tx) => {
    const existing = await findTransferByIdForUpdate(transferId, tx)
    if (!existing) throw new NotFoundError('Transfer not found')
    assertTransferAccess(user, existing)
    assertDraft(existing)
    const beforeLines = await selectTransferLines(transferId, tx)
    await deleteTransferLines(transferId, tx)
    await insertTransferLines(
      input.lines.map((line) => ({
        transferId,
        productId: line.productId,
        quantityRequested: line.quantityRequested,
      })),
      tx,
    )
    await writeAudit(
      {
        ...actor,
        action: 'transfer.updated',
        entity: 'transfer',
        entityId: transferId,
        branchId: existing.fromBranchId,
        before: { lineCount: beforeLines.length },
        after: { lineCount: input.lines.length, lines: input.lines },
      },
      tx,
    )
  })

  return loadTransferDetail(transferId)
}

export async function cancelTransfer(
  user: SessionUser,
  actor: AuditActor,
  transferId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const existing = await findTransferByIdForUpdate(transferId, tx)
    if (!existing) throw new NotFoundError('Transfer not found')
    assertTransferAccess(user, existing)
    assertDraft(existing)

    const updated = await updateTransferRow(
      transferId,
      { status: 'CANCELLED', cancelledBy: actor.actorId, cancelledAt: new Date() },
      tx,
    )
    if (!updated) throw new AppError(500, 'INTERNAL', 'Failed to cancel the transfer')

    await writeAudit(
      {
        ...actor,
        action: 'transfer.cancelled',
        entity: 'transfer',
        entityId: transferId,
        branchId: existing.fromBranchId,
        before: { status: existing.status },
        after: { status: updated.status },
      },
      tx,
    )
  })
}

/** Dispatches a draft; only the source-side manager (or admin) may do this. */
export async function dispatchTransfer(
  user: SessionUser,
  actor: AuditActor,
  transferId: string,
  input: DispatchInput,
): Promise<TransferDetail> {
  const existing = await findTransferById(transferId)
  if (!existing) throw new NotFoundError('Transfer not found')
  assertBranchAccess(user, existing.fromBranchId)

  await db.transaction(async (tx) => {
    const locked = await findTransferByIdForUpdate(transferId, tx)
    if (!locked) throw new NotFoundError('Transfer not found')
    if (locked.status !== 'DRAFT') {
      throw new ConflictError('Only draft transfers can be dispatched')
    }

    const lines = await selectTransferLineDetails(transferId, tx)
    assertLinesUnique(input.lines)
    if (input.lines.length !== lines.length) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Provide a dispatch quantity for every line')
    }

    const lineByProduct = new Map(lines.map((line) => [line.productId, line]))
    for (const entry of input.lines) {
      const line = lineByProduct.get(entry.productId)
      if (!line) throw new AppError(400, 'VALIDATION_ERROR', 'Unknown transfer line')
      if (entry.quantityDispatched > line.quantityRequested) {
        throw new AppError(
          400,
          'VALIDATION_ERROR',
          `Cannot dispatch more than requested for ${line.productName}`,
        )
      }
    }

    const dispatched = input.lines.filter((line) => line.quantityDispatched > 0)
    if (dispatched.length === 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'At least one line must be dispatched')
    }

    const posted = await inventoryService.postMovements(
      actor,
      dispatched.map((entry) => {
        const line = lineByProduct.get(entry.productId)
        return {
          productId: entry.productId,
          branchId: locked.fromBranchId,
          type: 'TRANSFER_OUT' as const,
          quantityDelta: -entry.quantityDispatched,
          referenceType: 'TRANSFER' as const,
          referenceId: transferId,
          referenceNumber: locked.number,
          productName: line?.productName,
        }
      }),
      { executor: tx },
    )
    const movementByProduct = new Map(posted.movements.map((row) => [row.productId, row]))

    for (const entry of input.lines) {
      const line = lineByProduct.get(entry.productId)
      if (!line) continue
      const movement = movementByProduct.get(entry.productId)
      await updateTransferLine(
        line.id,
        {
          quantityDispatched: entry.quantityDispatched,
          unitCostMinor: movement?.unitCostMinor ?? 0,
        },
        tx,
      )
    }

    const updated = await updateTransferRow(
      transferId,
      { status: 'DISPATCHED', dispatchedBy: actor.actorId, dispatchedAt: new Date() },
      tx,
    )
    if (!updated) throw new AppError(500, 'INTERNAL', 'Failed to dispatch the transfer')

    await writeAudit(
      {
        ...actor,
        action: 'transfer.dispatched',
        entity: 'transfer',
        entityId: transferId,
        branchId: locked.fromBranchId,
        after: { number: locked.number, lines: input.lines },
      },
      tx,
    )
  })

  return loadTransferDetail(transferId)
}

/** Receives a dispatched transfer; only the destination manager (or admin). */
export async function receiveTransfer(
  user: SessionUser,
  actor: AuditActor,
  transferId: string,
  input: ReceiveInput,
): Promise<TransferDetail> {
  const existing = await findTransferById(transferId)
  if (!existing) throw new NotFoundError('Transfer not found')
  assertBranchAccess(user, existing.toBranchId)

  await db.transaction(async (tx) => {
    const locked = await findTransferByIdForUpdate(transferId, tx)
    if (!locked) throw new NotFoundError('Transfer not found')
    if (locked.status !== 'DISPATCHED') {
      throw new ConflictError('Only dispatched transfers can be received')
    }

    const lines = await selectTransferLineDetails(transferId, tx)
    assertLinesUnique(input.lines)
    const lineByProduct = new Map(lines.map((line) => [line.productId, line]))
    for (const entry of input.lines) {
      const line = lineByProduct.get(entry.productId)
      if (!line) throw new AppError(400, 'VALIDATION_ERROR', 'Unknown transfer line')
      if (entry.quantityReceived > line.pending) {
        throw new ConflictError(`Cannot receive more than pending for ${line.productName}`)
      }
    }

    const receiving = input.lines.filter((line) => line.quantityReceived > 0)
    if (receiving.length === 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'At least one line must be received')
    }

    await inventoryService.postMovements(
      actor,
      receiving.map((entry) => {
        const line = lineByProduct.get(entry.productId)
        if (!line) throw new AppError(400, 'VALIDATION_ERROR', 'Unknown transfer line')
        return {
          productId: entry.productId,
          branchId: locked.toBranchId,
          type: 'TRANSFER_IN' as const,
          quantityDelta: entry.quantityReceived,
          unitCostMinor: line.unitCostMinor,
          referenceType: 'TRANSFER' as const,
          referenceId: transferId,
          referenceNumber: locked.number,
          productName: line.productName,
        }
      }),
      { executor: tx },
    )

    const receivedByProduct = new Map(
      input.lines.map((line) => [line.productId, line.quantityReceived]),
    )
    let allReceived = true
    for (const line of lines) {
      const delta = receivedByProduct.get(line.productId) ?? 0
      const quantityReceived = line.quantityReceived + delta
      if (delta > 0) {
        await updateTransferLine(line.id, { quantityReceived }, tx)
      }
      if (quantityReceived !== line.quantityDispatched) allReceived = false
    }

    const updated = await updateTransferRow(
      transferId,
      {
        status: allReceived ? 'RECEIVED' : 'DISPATCHED',
        receivedBy: actor.actorId,
        receivedAt: new Date(),
      },
      tx,
    )
    if (!updated) throw new AppError(500, 'INTERNAL', 'Failed to receive the transfer')

    await writeAudit(
      {
        ...actor,
        action: 'transfer.received',
        entity: 'transfer',
        entityId: transferId,
        branchId: locked.toBranchId,
        after: { number: locked.number, lines: input.lines, completed: allReceived },
      },
      tx,
    )
  })

  return loadTransferDetail(transferId)
}

/** Closes a partially received transfer, recording the shortfall (no movement). */
export async function shortCloseTransfer(
  user: SessionUser,
  actor: AuditActor,
  transferId: string,
  input: ShortCloseInput,
): Promise<TransferDetail> {
  const existing = await findTransferById(transferId)
  if (!existing) throw new NotFoundError('Transfer not found')
  assertBranchAccess(user, existing.toBranchId)

  await db.transaction(async (tx) => {
    const locked = await findTransferByIdForUpdate(transferId, tx)
    if (!locked) throw new NotFoundError('Transfer not found')
    if (locked.status !== 'DISPATCHED') {
      throw new ConflictError('Only dispatched transfers can be short-closed')
    }

    const lines = await selectTransferLineDetails(transferId, tx)
    const shortfalls = lines
      .filter((line) => line.pending > 0)
      .map((line) => ({
        productId: line.productId,
        sku: line.sku,
        productName: line.productName,
        pending: line.pending,
      }))
    if (shortfalls.length === 0) {
      throw new ConflictError('The transfer has no pending quantity to close')
    }

    const updated = await updateTransferRow(
      transferId,
      {
        status: 'SHORT_CLOSED',
        closedBy: actor.actorId,
        closedAt: new Date(),
        note: input.note,
      },
      tx,
    )
    if (!updated) throw new AppError(500, 'INTERNAL', 'Failed to close the transfer')

    await writeAudit(
      {
        ...actor,
        action: 'transfer.short_closed',
        entity: 'transfer',
        entityId: transferId,
        branchId: locked.toBranchId,
        after: { number: locked.number, note: input.note, shortfalls },
      },
      tx,
    )
  })

  return loadTransferDetail(transferId)
}
