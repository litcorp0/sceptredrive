import { type DbExecutor, db } from '@sceptre/db'
import { assertBranchAccess, branchScope, resolveBranchFilter, roleOf } from '../../auth/scope.ts'
import { actorLabel } from '../../http/audit-context.ts'
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../http/errors.ts'
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
import type { PostMovementsResult, StockAdjustmentReason } from '../inventory/inventory.types.ts'
import * as branchesService from '../org/branches.service.ts'
import { writeAudit } from '../platform/audit.service.ts'
import type { AuditActor } from '../platform/audit.types.ts'
import { allocateDocumentNumber } from '../platform/sequences.service.ts'
import { findProductById } from '../products/products.repository.ts'
import {
  countWriteOffs,
  findWriteOffById,
  insertWriteOff,
  insertWriteOffLines,
  lockWriteOffForUpdate,
  selectWriteOffBase,
  selectWriteOffLines,
  selectWriteOffLinesForValue,
  selectWriteOffPage,
  updateWriteOffRow,
} from './writeoffs.repository.ts'
import type {
  StockWriteOffReason,
  WriteOffApproval,
  WriteOffCreateInput,
  WriteOffDetail,
  WriteOffLineInput,
  WriteOffListQuery,
  WriteOffListResponse,
} from './writeoffs.types.ts'

/**
 * A stock write-off is the branch manager's form for goods that left the shelf
 * without a sale: broken, expired, obsolete, stolen or returned by a supplier.
 *
 * It is a document, not an adjustment (P12-D14): raised complete, decided as one
 * unit, and `APPROVED` means **posted** — the decision handler appends the
 * `WRITE_OFF` movements in the same transaction that stamps `posted_at`. The
 * value is frozen at request time from the branch's average cost, and the posted
 * movement carries that stored cost, so the approved value and the ledger value
 * are the same number even if a receipt moves the average in between (P12-D17).
 */

/**
 * The one value that differs between the form's vocabulary and the ledger's.
 * The lists stay separate on purpose: `EXPIRED` describes a date that passed,
 * `EXPIRY` describes why the goods left (P12-D15).
 */
const MOVEMENT_REASON: Record<StockWriteOffReason, StockAdjustmentReason> = {
  DAMAGE: 'DAMAGE',
  EXPIRY: 'EXPIRED',
  OBSOLESCENCE: 'OBSOLESCENCE',
  THEFT: 'THEFT',
  SUPPLIER_FAULT: 'SUPPLIER_FAULT',
  OTHER: 'OTHER',
}

function assertLinesUnique(lines: readonly { productId: string }[]): void {
  if (new Set(lines.map((line) => line.productId)).size !== lines.length) {
    throw new ValidationError('Each product may appear only once')
  }
}

/**
 * Every product must exist and be active, and the refusal for a missing note
 * must name the product the manager can find on the shelf.
 */
async function validateLines(lines: readonly WriteOffLineInput[]): Promise<void> {
  const names = new Map<string, string>()
  for (const line of lines) {
    const found = await findProductById(line.productId)
    if (!found) throw new NotFoundError('Product not found')
    if (!found.isActive) throw new ConflictError('The product is archived')
    names.set(line.productId, found.name)
  }

  for (const line of lines) {
    if ((line.reason === 'THEFT' || line.reason === 'OTHER') && !line.note) {
      throw new ValidationError(
        `A ${line.reason} write-off needs a note explaining what happened to "${names.get(line.productId) ?? line.productId}"`,
      )
    }
  }
}

/**
 * The request behind a write-off, read through the approvals service so the
 * approval table has one reader per contract. `newest` because a document has at
 * most one live approval and the decided one is the interesting one.
 */
async function loadWriteOffApproval(
  user: SessionUser,
  writeOffId: string,
): Promise<WriteOffApproval | null> {
  const { approvals } = await listApprovals(user, {
    type: 'STOCK_WRITE_OFF',
    entityId: writeOffId,
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

async function loadWriteOffDetail(
  writeOffId: string,
  user: SessionUser,
  executor: DbExecutor = db,
): Promise<WriteOffDetail> {
  const base = await selectWriteOffBase(writeOffId, executor)
  if (!base) throw new NotFoundError('Stock write-off not found')
  const [lines, approval] = await Promise.all([
    selectWriteOffLines(writeOffId, executor),
    loadWriteOffApproval(user, writeOffId),
  ])
  return { writeOff: base, lines, approval }
}

/**
 * Raises the document at the caller's own branch.
 *
 * An admin is refused: an admin has nobody to approve them, and their direct
 * path is a negative adjustment with a reason code (P12-D3). Everything else is
 * decided here, never by the body: the branch comes from the session, the status
 * is always `PENDING_APPROVAL`, and the value is computed server-side.
 */
export async function createWriteOff(
  user: SessionUser,
  actor: AuditActor,
  input: WriteOffCreateInput,
): Promise<WriteOffDetail> {
  if (roleOf(user) === 'ADMIN') {
    throw new ValidationError(
      'An admin posts a negative adjustment directly; this form is for branch managers',
    )
  }

  const scope = branchScope(user)
  if (scope === null) throw new ForbiddenError('A write-off must be raised at a branch')

  const branch = await branchesService.getBranch(user, scope)
  if (!branch.isActive) throw new ConflictError('The branch is inactive')

  assertLinesUnique(input.lines)
  await validateLines(input.lines)

  const reasons = [...new Set(input.lines.map((line) => line.reason))].sort()

  const writeOffId = await db.transaction(async (tx) => {
    // The branch's own projection is the valuation source: the number the
    // manager sees is the number the decider is given, to the pesewa (P12-D17).
    const levels = await selectWriteOffLinesForValue(
      branch.id,
      input.lines.map((line) => line.productId),
      tx,
    )
    const priced = input.lines.map((line) => ({
      ...line,
      unitCostMinor: levels.get(line.productId)?.avgCostMinor ?? 0,
    }))
    const valueMinor = priced.reduce((sum, line) => sum + line.quantity * line.unitCostMinor, 0)

    const { number } = await allocateDocumentNumber('stock_write_off', branch.id, tx)
    const created = await insertWriteOff(
      {
        number,
        branchId: branch.id,
        status: 'PENDING_APPROVAL',
        note: input.note ?? null,
        valueMinor,
        requestedBy: actorLabel(actor) ?? 'unknown',
        createdBy: actorLabel(actor),
      },
      tx,
    )
    if (!created) throw new AppError(500, 'INTERNAL', 'Failed to create the stock write-off')

    await insertWriteOffLines(
      priced.map((line) => ({
        writeOffId: created.id,
        productId: line.productId,
        quantity: line.quantity,
        unitCostMinor: line.unitCostMinor,
        reason: line.reason,
        note: line.note ?? null,
      })),
      tx,
    )

    // An admin decides every write-off, in any branch: the branch's own manager
    // may be the person who raised it (P12-D2, self-approval is blocked anyway).
    const approval = await requestApproval(
      actor,
      {
        type: 'STOCK_WRITE_OFF',
        entityId: created.id,
        branchId: branch.id,
        amountMinor: valueMinor,
        payload: { number, lineCount: priced.length, reasons },
        note: input.note ?? null,
        deciderRole: 'ADMIN',
        deciderBranchId: null,
      },
      tx,
    )

    await updateWriteOffRow(created.id, { approvalId: approval.id }, tx)

    await writeAudit(
      {
        ...actor,
        action: 'stock_write_off.requested',
        entity: 'stock_write_off',
        entityId: created.id,
        branchId: branch.id,
        after: {
          number,
          valueMinor,
          lineCount: priced.length,
          reasons,
          lines: priced,
          approvalId: approval.id,
        },
      },
      tx,
    )

    return created.id
  })

  return loadWriteOffDetail(writeOffId, user)
}

export async function listWriteOffs(
  user: SessionUser,
  query: WriteOffListQuery,
): Promise<WriteOffListResponse> {
  const branchId = resolveBranchFilter(user, query.branchId ?? null)
  const filters = {
    branchId,
    status: query.status,
    limit: query.limit,
    offset: query.offset,
  }
  const [writeOffs, total] = await Promise.all([
    selectWriteOffPage(filters),
    countWriteOffs(filters),
  ])
  return { writeOffs, total, branchId }
}

export async function getWriteOff(user: SessionUser, writeOffId: string): Promise<WriteOffDetail> {
  const row = await findWriteOffById(writeOffId)
  if (!row) throw new NotFoundError('Stock write-off not found')
  assertBranchAccess(user, row.branchId)
  return loadWriteOffDetail(writeOffId, user)
}

/**
 * Withdraws a request nobody has decided. Only the requester, and only while it
 * is pending; the pending approval is withdrawn in the same transaction so the
 * decider's queue cannot hold a document that no longer exists (P12-D7).
 */
export async function cancelWriteOff(
  user: SessionUser,
  actor: AuditActor,
  writeOffId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const existing = await lockWriteOffForUpdate(writeOffId, tx)
    if (!existing) throw new NotFoundError('Stock write-off not found')
    assertBranchAccess(user, existing.branchId)

    if (existing.requestedBy !== (actorLabel(actor) ?? 'unknown')) {
      throw new ForbiddenError('Only the requester can cancel this write-off')
    }
    if (existing.status !== 'PENDING_APPROVAL') {
      throw new ConflictError(`A write-off with status ${existing.status} cannot be cancelled`)
    }

    const pending = await findPendingApprovalForEntity('STOCK_WRITE_OFF', writeOffId, tx)
    let withdrawnApprovalId: string | null = null
    if (pending) {
      const withdrawn = await withdrawApprovalRow(pending.id, tx)
      if (!withdrawn) throw new AppError(500, 'INTERNAL', 'Failed to withdraw the request')
      withdrawnApprovalId = withdrawn.id
    }

    const updated = await updateWriteOffRow(
      writeOffId,
      { status: 'CANCELLED', cancelledBy: actorLabel(actor), cancelledAt: new Date() },
      tx,
    )
    if (!updated) throw new AppError(500, 'INTERNAL', 'Failed to cancel the stock write-off')

    await writeAudit(
      {
        ...actor,
        action: 'stock_write_off.cancelled',
        entity: 'stock_write_off',
        entityId: writeOffId,
        branchId: existing.branchId,
        before: { status: existing.status },
        after: { status: updated.status, approvalId: withdrawnApprovalId },
      },
      tx,
    )
  })
}

/**
 * Plan 05's half of the decision registry (P12-D8).
 *
 * Runs inside `decideApproval`'s transaction, before the approval's own status
 * change, so a refusal rolls the whole decision back. `REJECTED` writes the
 * status and nothing else: no movement, no level change, no `posted_at` — the
 * ledger is byte-identical after a rejection (P12-D12, P12-D14).
 *
 * `APPROVED` posts every line through the one movement writer with the **stored**
 * line cost, then stamps `posted_at`. A line that would drive stock negative is
 * refused with a 409 by that writer, and the message tells the manager to
 * re-raise the request for the quantity actually on hand (P12-D17).
 */
registerDecisionHandler('STOCK_WRITE_OFF', async (tx, approval, actor, decision) => {
  if (!approval.entityId) {
    throw new AppError(500, 'INTERNAL', 'A stock write-off approval has no write-off')
  }

  const writeOff = await lockWriteOffForUpdate(approval.entityId, tx)
  if (!writeOff) throw new NotFoundError('Stock write-off not found')
  if (writeOff.status !== 'PENDING_APPROVAL') {
    throw new ConflictError('This write-off has already moved')
  }

  if (decision === 'REJECTED') {
    const rejected = await updateWriteOffRow(writeOff.id, { status: 'REJECTED' }, tx)
    if (!rejected) throw new AppError(500, 'INTERNAL', 'Failed to reject the stock write-off')

    await writeAudit(
      {
        ...actor,
        action: 'stock_write_off.rejected',
        entity: 'stock_write_off',
        entityId: writeOff.id,
        branchId: writeOff.branchId,
        before: { status: 'PENDING_APPROVAL' },
        after: { status: 'REJECTED', approvalId: approval.id },
      },
      tx,
    )
    return undefined
  }

  const lines = await selectWriteOffLines(writeOff.id, tx)
  if (lines.length === 0) {
    throw new ConflictError('This write-off has no lines to post')
  }

  let posted: PostMovementsResult
  try {
    posted = await inventoryService.postMovements(
      actor,
      lines.map((line) => ({
        productId: line.productId,
        branchId: writeOff.branchId,
        type: 'WRITE_OFF' as const,
        quantityDelta: -line.quantity,
        // The stored line cost, not today's average: the ledger value equals the
        // value the admin approved (P12-D17).
        unitCostMinor: line.unitCostMinor,
        referenceType: 'WRITE_OFF' as const,
        referenceId: writeOff.id,
        referenceNumber: writeOff.number,
        reasonCode: MOVEMENT_REASON[line.reason],
        note: line.note ?? undefined,
        productName: line.productName,
      })),
      { executor: tx },
    )
  } catch (error) {
    if (error instanceof ConflictError) {
      throw new ConflictError(
        `${error.message}. Re-raise the write-off for the quantity actually on hand.`,
      )
    }
    throw error
  }

  const approved = await updateWriteOffRow(
    writeOff.id,
    { status: 'APPROVED', postedAt: new Date() },
    tx,
  )
  if (!approved) throw new AppError(500, 'INTERNAL', 'Failed to approve the stock write-off')

  await writeAudit(
    {
      ...actor,
      action: 'stock_write_off.approved',
      entity: 'stock_write_off',
      entityId: writeOff.id,
      branchId: writeOff.branchId,
      before: { status: 'PENDING_APPROVAL' },
      after: {
        status: 'APPROVED',
        approvalId: approval.id,
        valueMinor: writeOff.valueMinor,
        movementIds: posted.movements.map((movement) => movement.id),
      },
    },
    tx,
  )

  return undefined
})

/**
 * Plan 05's half of the subject registry: the decider is shown the document's
 * number and how many lines it holds, and reads the lines themselves through
 * `/api/write-offs/:id`, which applies its own branch check. Read-only and
 * transaction-free (P12-D4).
 */
registerSubjectLoader('STOCK_WRITE_OFF', async (approval) => {
  if (!approval.entityId) return { kind: 'other' }
  const writeOff = await findWriteOffById(approval.entityId)
  if (!writeOff) throw new NotFoundError('Stock write-off not found')
  const lines = await selectWriteOffLines(writeOff.id)
  return {
    kind: 'stock_write_off',
    writeOffId: writeOff.id,
    number: writeOff.number,
    lineCount: lines.length,
  }
})
