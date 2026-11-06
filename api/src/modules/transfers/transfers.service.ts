import { type DbExecutor, db } from '@sceptre/db'
import { assertBranchAccess, branchScope, resolveBranchFilter, roleOf } from '../../auth/scope.ts'
import { actorLabel } from '../../http/audit-context.ts'
import { AppError, ConflictError, ForbiddenError, NotFoundError } from '../../http/errors.ts'
import type { SessionUser } from '../../http/factory.ts'
import {
  findPendingApprovalForEntity,
  withdrawApprovalRow,
} from '../approvals/approvals.repository.ts'
import {
  listApprovals,
  registerDecisionHandler,
  registerSubjectLoader,
  requestApproval,
} from '../approvals/approvals.service.ts'
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
  insertTransfer,
  insertTransferLines,
  searchSourceStock as searchSourceStockRows,
  selectLevelsForProducts,
  selectTransferBase,
  selectTransferLineDetails,
  selectTransferLines,
  selectTransferPage,
  updateTransferLine,
  updateTransferRow,
} from './transfers.repository.ts'
import type {
  DispatchInput,
  LevelSnapshot,
  ReceiveInput,
  ShortCloseInput,
  TransferApproval,
  TransferCreateInput,
  TransferDetail,
  TransferLineInput,
  TransferLinesReplaceInput,
  TransferListQuery,
  TransferListRow,
  TransferRow,
  TransferStatus,
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

/**
 * Cancel and withdraw: a draft an admin created, or a request nobody has decided
 * yet. A dispatched transfer is stock in a van and is never cancelled (P12-D12).
 */
function assertCancellable(row: TransferRow): void {
  if (row.status !== 'DRAFT' && row.status !== 'REQUESTED') {
    throw new ConflictError(`A transfer with status ${row.status} cannot be cancelled`)
  }
}

/**
 * Dispatch needs the source branch's agreement. A `DRAFT` is that agreement when
 * an admin created it directly (P12-D10); a request needs an `APPROVED` decision.
 * The status is named in the message so a console can explain the refusal.
 */
function assertDispatchable(row: TransferRow): void {
  if (row.status === 'DRAFT' || row.status === 'APPROVED') return
  if (row.status === 'REQUESTED') {
    throw new ConflictError(
      'This transfer is still REQUESTED: the source branch must decide it before dispatch',
    )
  }
  if (row.status === 'REJECTED') {
    throw new ConflictError(
      'This transfer was REJECTED by the source branch and cannot be dispatched',
    )
  }
  throw new ConflictError(`A transfer with status ${row.status} cannot be dispatched`)
}

/** The source side, or an admin, is the only actor who may release stock. */
function canDispatch(user: SessionUser, row: TransferListRow): boolean {
  const scope = branchScope(user)
  return (
    (row.status === 'DRAFT' || row.status === 'APPROVED') &&
    (scope === null || scope === row.fromBranchId)
  )
}

function assertLinesUnique(lines: readonly { productId: string }[]): void {
  if (new Set(lines.map((line) => line.productId)).size !== lines.length) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Each product may appear only once')
  }
}

/** Product names for one error message; one read, no per-line query. */
async function productLabels(
  productIds: readonly string[],
  executor: DbExecutor,
): Promise<Map<string, string>> {
  const labels = new Map<string, string>()
  for (const id of new Set(productIds)) {
    const found = await findProductById(id, executor)
    if (found) labels.set(id, `${found.sku} ${found.name}`)
  }
  return labels
}

async function validateLineProducts(
  lines: readonly TransferLineInput[],
  executor: DbExecutor = db,
): Promise<void> {
  for (const line of lines) {
    await requireActiveProduct(line.productId, executor)
  }
}

/**
 * The request behind a transfer, read through the approvals service so the
 * approval table has one reader per contract. `newest` because a document has at
 * most one live approval, and the decided one is the interesting one.
 */
async function loadTransferApproval(
  user: SessionUser,
  transferId: string,
): Promise<TransferApproval | null> {
  const { approvals } = await listApprovals(user, {
    type: 'TRANSFER_REQUEST',
    entityId: transferId,
    sort: 'newest',
    limit: 1,
    offset: 0,
  })
  const row = approvals[0]
  if (!row) return null
  return {
    id: row.id,
    status: row.status,
    requestedBy: row.requestedBy,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
    decisionReasonCode: row.decisionReasonCode,
  }
}

async function loadTransferDetail(id: string, user: SessionUser): Promise<TransferDetail> {
  const base = await selectTransferBase(id)
  if (!base) throw new NotFoundError('Transfer not found')
  const lineRows = await selectTransferLineDetails(id)
  const productIds = lineRows.map((line) => line.productId)
  const [fromLevels, toLevels, approval] = await Promise.all([
    selectLevelsForProducts(base.fromBranchId, productIds),
    selectLevelsForProducts(base.toBranchId, productIds),
    loadTransferApproval(user, id),
  ])
  const onHand = (levels: Map<string, LevelSnapshot>, productId: string) =>
    levels.get(productId)?.quantityOnHand ?? 0
  const lines = lineRows.map((line) => ({
    ...line,
    fromOnHand: onHand(fromLevels, line.productId),
    toOnHand: onHand(toLevels, line.productId),
  }))
  return {
    ...base,
    lineCount: lines.length,
    unitsDispatched: lines.reduce((sum, line) => sum + line.quantityDispatched, 0),
    unitsReceived: lines.reduce((sum, line) => sum + line.quantityReceived, 0),
    lines,
    approval,
    canDispatch: canDispatch(user, base),
  }
}

/**
 * Creates the document a branch is asking for.
 *
 * A manager raises a **request** at their own branch: `REQUESTED`, with a
 * `TRANSFER_REQUEST` approval the source branch decides, in the same
 * transaction (P12-D10). An admin creates a **draft** directly — an admin has
 * nobody to approve them, and their direct path is the draft (P12-D3). There is
 * deliberately no `status` input: the actor's role decides, not the body.
 */
export async function createTransfer(
  user: SessionUser,
  actor: AuditActor,
  input: TransferCreateInput,
): Promise<TransferDetail> {
  assertLinesUnique(input.lines)
  const isAdmin = roleOf(user) === 'ADMIN'
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
  // The destination asks; the source agrees. A manager creating an outgoing
  // transfer would be dispatching their own request, which is the hole D4 closes.
  if (!isAdmin && to.id !== scope) {
    throw new ForbiddenError('A transfer request is raised by the destination branch.')
  }
  await validateLineProducts(input.lines)

  const productIds = input.lines.map((line) => line.productId)

  const transferId = await db.transaction(async (tx) => {
    // Value frozen at request time from the source's own projection: the same
    // read the detail shows, so the number a manager sees is the number the
    // decider is given (P12-D6).
    const sourceLevels = await selectLevelsForProducts(from.id, productIds, tx)

    // Never ask for more than the source actually holds (P20-D18). A request for 50
    // against a shelf of 3 is not a negotiation, it is a typo the source manager would
    // have to reject — and the shelf is the only number that matters here. The till's
    // oversell rules are untouched: this refuses a *request*, not a sale.
    const overRequested = input.lines.filter(
      (line) => line.quantityRequested > (sourceLevels.get(line.productId)?.quantityOnHand ?? 0),
    )
    if (overRequested.length > 0) {
      const names = await productLabels(
        overRequested.map((line) => line.productId),
        tx,
      )
      throw new ConflictError(
        `The source branch does not hold that much: ${overRequested
          .map(
            (line) =>
              `${names.get(line.productId) ?? line.productId} (asked ${line.quantityRequested})`,
          )
          .join(', ')}`,
      )
    }

    const amountMinor = input.lines.reduce(
      (sum, line) =>
        sum + line.quantityRequested * (sourceLevels.get(line.productId)?.avgCostMinor ?? 0),
      0,
    )

    const status: TransferStatus = isAdmin ? 'DRAFT' : 'REQUESTED'
    const number = await allocateFromSequence('inventory.transferSequence', tx)
    const created = await insertTransfer(
      {
        number,
        fromBranchId: from.id,
        toBranchId: to.id,
        status,
        note: input.note ?? null,
        createdBy: actorLabel(actor),
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

    let approvalId: string | null = null
    if (status === 'REQUESTED') {
      // Authority follows the branch that holds the stock (P12-D11): a retail
      // source is decided by that branch's manager, a warehouse by an admin.
      const retailSource = from.type === 'RETAIL'
      const approval = await requestApproval(
        actor,
        {
          type: 'TRANSFER_REQUEST',
          entityId: created.id,
          branchId: to.id,
          amountMinor,
          payload: {
            fromBranchId: from.id,
            toBranchId: to.id,
            fromBranchType: from.type,
            lineCount: input.lines.length,
          },
          note: input.note ?? null,
          deciderRole: retailSource ? 'MANAGER' : 'ADMIN',
          deciderBranchId: retailSource ? from.id : null,
        },
        tx,
      )
      approvalId = approval.id
    }

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
          status,
          approvalId,
        },
      },
      tx,
    )
    return created.id
  })

  return loadTransferDetail(transferId, user)
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

/**
 * What one branch can give, for the transfer form's picker (P20-D18).
 *
 * Deliberately **not** branch-scoped: the form's whole purpose is to ask another branch for
 * stock, so a manager must see whether the source can fill the request. It returns a name, a
 * code and a quantity — never cost, price or another branch's movements.
 */
export async function searchSourceStock(
  branchId: string,
  query: string,
  includeEmpty: boolean,
): Promise<{
  products: { productId: string; sku: string; name: string; quantityOnHand: number }[]
}> {
  const branchRow = await findBranchById(branchId)
  if (!branchRow) throw new NotFoundError('Branch not found')
  if (!branchRow.isActive) throw new ConflictError('That branch is inactive')

  return { products: await searchSourceStockRows(branchId, query, includeEmpty) }
}

export async function listTransfers(
  user: SessionUser,
  query: TransferListQuery,
): Promise<{ transfers: TransferListRow[]; total: number; branchId: string | null }> {
  const branchId = resolveBranchFilter(user, query.branchId ?? null)
  const filters = {
    branchId,
    status: query.status,
    direction: query.direction,
    from: query.from,
    to: query.to ? inclusiveEnd(query.to) : undefined,
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
  return loadTransferDetail(transferId, user)
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

  return loadTransferDetail(transferId, user)
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

  return loadTransferDetail(transferId, user)
}

/**
 * Cancels a draft, or withdraws a request nobody has decided.
 *
 * A `REQUESTED` cancel takes its pending approval with it in the same
 * transaction, so the decider's queue cannot hold a document that no longer
 * exists (P12-D7). The approval row is closed as `WITHDRAWN`, never deleted.
 */
export async function cancelTransfer(
  user: SessionUser,
  actor: AuditActor,
  transferId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const existing = await findTransferByIdForUpdate(transferId, tx)
    if (!existing) throw new NotFoundError('Transfer not found')
    assertTransferAccess(user, existing)
    assertCancellable(existing)

    let withdrawnApprovalId: string | null = null
    if (existing.status === 'REQUESTED') {
      const pending = await findPendingApprovalForEntity('TRANSFER_REQUEST', transferId, tx)
      if (pending) {
        const withdrawn = await withdrawApprovalRow(pending.id, tx)
        if (!withdrawn) throw new AppError(500, 'INTERNAL', 'Failed to withdraw the request')
        withdrawnApprovalId = withdrawn.id
      }
    }

    const updated = await updateTransferRow(
      transferId,
      { status: 'CANCELLED', cancelledBy: actorLabel(actor), cancelledAt: new Date() },
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
        after: { status: updated.status, approvalId: withdrawnApprovalId },
      },
      tx,
    )
  })
}

/** Dispatches an approved (or admin-drafted) transfer; source side only. */
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
    assertDispatchable(locked)

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
      { status: 'DISPATCHED', dispatchedBy: actorLabel(actor), dispatchedAt: new Date() },
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

  return loadTransferDetail(transferId, user)
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
        receivedBy: actorLabel(actor),
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

  return loadTransferDetail(transferId, user)
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
        closedBy: actorLabel(actor),
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

  return loadTransferDetail(transferId, user)
}

/**
 * Plan 04's half of the decision registry (P12-D8).
 *
 * Runs inside `decideApproval`'s transaction and before the approval's own
 * status change, so a refusal rolls the whole decision back. `REJECTED` posts no
 * movement and touches no level: the ledger is byte-identical after a rejection
 * (P12-D12).
 */
registerDecisionHandler('TRANSFER_REQUEST', async (tx, approval, actor, decision, input) => {
  if (!approval.entityId) {
    throw new AppError(500, 'INTERNAL', 'A transfer approval has no transfer')
  }

  const transfer = await findTransferByIdForUpdate(approval.entityId, tx)
  if (!transfer) throw new NotFoundError('Transfer not found')
  if (transfer.status !== 'REQUESTED') {
    throw new ConflictError('This transfer has already moved')
  }

  const status: TransferStatus = decision === 'APPROVED' ? 'APPROVED' : 'REJECTED'
  const updated = await updateTransferRow(transfer.id, { status }, tx)
  if (!updated) throw new AppError(500, 'INTERNAL', 'Failed to record the transfer decision')

  await writeAudit(
    {
      ...actor,
      action: `transfer.${status.toLowerCase()}`,
      entity: 'transfer',
      entityId: transfer.id,
      branchId: transfer.toBranchId,
      before: { status: 'REQUESTED' },
      after: { status, approvalId: approval.id, reasonCode: input.reasonCode ?? null },
    },
    tx,
  )

  return undefined
})

/**
 * Plan 04's half of the subject registry: the decider is shown what is being
 * asked for — both branches and the number of lines — and the console reads the
 * lines themselves through `/api/transfers/:id`, which applies its own access
 * check. Read-only and transaction-free (P12-D4).
 */
registerSubjectLoader('TRANSFER_REQUEST', async (approval) => {
  if (!approval.entityId) return { kind: 'other' }
  const transfer = await findTransferById(approval.entityId)
  if (!transfer) throw new NotFoundError('Transfer not found')
  const lines = await selectTransferLines(transfer.id)
  return {
    kind: 'transfer',
    transferId: transfer.id,
    fromBranchId: transfer.fromBranchId,
    toBranchId: transfer.toBranchId,
    lineCount: lines.length,
  }
})
