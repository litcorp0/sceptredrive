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
import { listApprovals, requestApproval } from '../approvals/approvals.service.ts'
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
