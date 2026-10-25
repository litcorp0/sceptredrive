import type { DbExecutor, DbTransaction } from '@sceptre/db'
import { db } from '@sceptre/db'
import {
  type ApprovalReasonCode,
  type ApprovalType,
  approvalDeciderRole,
  isDecided,
} from '@sceptre/shared'
import { assertBranchAccess, hasPermission, resolveBranchFilter, roleOf } from '../../auth/scope.ts'
import { actorLabel } from '../../http/audit-context.ts'
import { AppError, ForbiddenError, NotFoundError } from '../../http/errors.ts'
import type { SessionUser } from '../../http/factory.ts'
import { writeAudit } from '../platform/audit.service.ts'
import type { AuditActor } from '../platform/audit.types.ts'
import { getResolvedSetting } from '../platform/settings.service.ts'
import {
  countApprovals,
  findApprovalById,
  insertApproval,
  lockApprovalForUpdate,
  pointApprovalAtEntity,
  selectApprovalPage,
  updateApprovalDecision,
  withdrawApprovalRow,
} from './approvals.repository.ts'
import type {
  ApprovalDetail,
  ApprovalList,
  ApprovalListQuery,
  ApprovalRow,
  ApprovalSubject,
} from './approvals.types.ts'

/**
 * The approval lifecycle and the decision registry.
 *
 * The registry exists so a decision can act on its own document without this
 * module importing every owner: `products` and `procurement` register their
 * handlers at module load, and the dependency runs one way only
 * (`owner → approvals`). An unregistered type is a programming error and fails
 * loudly at boot (`assertDecisionHandlersRegistered`) rather than at 4pm on a
 * Friday.
 */

export type DecisionHandler = (
  tx: DbTransaction,
  approval: ApprovalRow,
  actor: AuditActor,
  decision: 'APPROVED' | 'REJECTED',
  input: { reasonCode?: ApprovalReasonCode; note?: string },
) => Promise<{ entityId?: string } | undefined>

const HANDLERS = new Map<ApprovalType, DecisionHandler>()

export function registerDecisionHandler(type: ApprovalType, handler: DecisionHandler): void {
  HANDLERS.set(type, handler)
}

export function assertDecisionHandlersRegistered(required: readonly ApprovalType[]): void {
  const missing = required.filter((type) => !HANDLERS.has(type))
  if (missing.length > 0) {
    throw new Error(`No approval decision handler registered for: ${missing.join(', ')}`)
  }
}

/** Test seam: the registry is module state, so a test can inspect what is wired. */
export function registeredDecisionTypes(): ApprovalType[] {
  return [...HANDLERS.keys()]
}

export interface ApprovalRequestInput {
  type: ApprovalType
  entityId?: string | null
  branchId: string
  amountMinor?: number | null
  payload?: Record<string, unknown>
  note?: string | null
}

/** Called inside the requesting service's transaction. Returns the new approval. */
export async function requestApproval(
  actor: AuditActor,
  input: ApprovalRequestInput,
  executor: DbExecutor,
): Promise<ApprovalRow> {
  const created = await insertApproval(
    {
      type: input.type,
      entityId: input.entityId ?? null,
      branchId: input.branchId,
      requestedBy: actorLabel(actor) ?? 'unknown',
      amountMinor: input.amountMinor ?? null,
      payload: input.payload ?? {},
      requestNote: input.note ?? null,
    },
    executor,
  )

  await writeAudit(
    {
      ...actor,
      action: 'approval.requested',
      entity: 'approval',
      entityId: created.id,
      branchId: created.branchId,
      after: {
        type: created.type,
        subjectId: created.entityId,
        amountMinor: created.amountMinor,
      },
    },
    executor,
  )

  return created
}

export async function resolveApprovalThreshold(
  branchId: string,
  executor: DbExecutor = db,
): Promise<{ thresholdMinor: number; source: 'branch' | 'global' | 'default' }> {
  const resolved = await getResolvedSetting(
    'procurement.approvalThresholdMinor',
    { branchId },
    executor,
  )
  return { thresholdMinor: resolved.value, source: resolved.source }
}

export async function decideApproval(
  user: SessionUser,
  actor: AuditActor,
  approvalId: string,
  input: {
    decision: 'APPROVED' | 'REJECTED'
    reasonCode?: ApprovalReasonCode
    note?: string
  },
): Promise<ApprovalDetail> {
  if (!hasPermission(user, 'procurement.approve')) {
    throw new ForbiddenError('Only an admin can decide this request')
  }
  if (input.decision === 'REJECTED' && !input.reasonCode) {
    throw new AppError(400, 'VALIDATION_ERROR', 'A rejection needs a reason code')
  }

  const decided = await db.transaction(async (tx) => {
    const current = await lockApprovalForUpdate(approvalId, tx)
    if (!current) throw new NotFoundError('Approval not found')

    assertBranchAccess(user, current.branchId)

    if (isDecided(current.status)) {
      throw new AppError(409, 'CONFLICT', 'This request has already been decided')
    }
    if (roleOf(user) !== approvalDeciderRole(current.type)) {
      throw new ForbiddenError('Your role cannot decide this request')
    }

    // Structural, not a permission: nobody decides their own request. P11-D18
    // removes the purchase-order case by auto-approving an admin's own order, and
    // this check keeps every future type honest.
    if (current.requestedBy === (actorLabel(actor) ?? 'unknown')) {
      throw new ForbiddenError('You cannot decide your own request')
    }

    const handler = HANDLERS.get(current.type)
    if (!handler) {
      throw new AppError(500, 'INTERNAL', `No decision handler for ${current.type}`)
    }

    // The handler runs before the status change, in the same transaction: if the
    // document refuses the decision, nothing is recorded and nothing is half-done.
    const result = await handler(tx, current, actor, input.decision, input)

    const updated = await updateApprovalDecision(
      current.id,
      {
        status: input.decision,
        decidedBy: actorLabel(actor) ?? 'unknown',
        decidedAt: new Date(),
        decisionReasonCode: input.reasonCode ?? null,
        decisionNote: input.note ?? null,
      },
      tx,
    )
    if (!updated) throw new AppError(500, 'INTERNAL', 'Failed to record the decision')

    if (result?.entityId && !current.entityId) {
      await pointApprovalAtEntity(current.id, result.entityId, tx)
      updated.entityId = result.entityId
    }

    await writeAudit(
      {
        ...actor,
        action: 'approval.decided',
        entity: 'approval',
        entityId: current.id,
        branchId: current.branchId,
        before: { status: current.status },
        after: {
          status: updated.status,
          reasonCode: updated.decisionReasonCode,
          subjectId: updated.entityId,
        },
      },
      tx,
    )

    return updated
  })

  return buildDetail(user, actor, decided)
}

export async function withdrawApproval(
  user: SessionUser,
  actor: AuditActor,
  approvalId: string,
): Promise<ApprovalRow> {
  return db.transaction(async (tx) => {
    const current = await lockApprovalForUpdate(approvalId, tx)
    if (!current) throw new NotFoundError('Approval not found')
    assertBranchAccess(user, current.branchId)

    if (current.requestedBy !== (actorLabel(actor) ?? 'unknown')) {
      throw new ForbiddenError('Only the requester can withdraw this request')
    }
    if (isDecided(current.status)) {
      throw new AppError(409, 'CONFLICT', 'This request has already been decided')
    }

    const updated = await withdrawApprovalRow(current.id, tx)
    if (!updated) throw new AppError(500, 'INTERNAL', 'Failed to withdraw the request')

    await writeAudit(
      {
        ...actor,
        action: 'approval.withdrawn',
        entity: 'approval',
        entityId: current.id,
        branchId: current.branchId,
        before: { status: current.status },
        after: { status: 'WITHDRAWN' },
      },
      tx,
    )
    return updated
  })
}

export async function listApprovals(
  user: SessionUser,
  query: {
    type?: ApprovalType
    status?: ApprovalListQuery['status']
    branchId?: string | null
    limit: number
    offset: number
  },
): Promise<ApprovalList> {
  const branchId = resolveBranchFilter(user, query.branchId ?? null)
  const filters: ApprovalListQuery = {
    type: query.type,
    status: query.status,
    branchId,
    limit: query.limit,
    offset: query.offset,
  }
  const [approvals, total] = await Promise.all([
    selectApprovalPage(filters),
    countApprovals(filters),
  ])
  return { approvals, total, branchId }
}

export async function getApproval(
  user: SessionUser,
  actor: AuditActor,
  approvalId: string,
): Promise<ApprovalDetail> {
  const found = await findApprovalById(approvalId)
  if (!found) throw new NotFoundError('Approval not found')
  assertBranchAccess(user, found.branchId)
  return buildDetail(user, actor, found)
}

function buildDetail(user: SessionUser, actor: AuditActor, approval: ApprovalRow): ApprovalDetail {
  const self = approval.requestedBy === (actorLabel(actor) ?? 'unknown')
  const canDecide =
    !isDecided(approval.status) &&
    !self &&
    hasPermission(user, 'procurement.approve') &&
    roleOf(user) === approvalDeciderRole(approval.type)

  return {
    approval,
    subject: subjectOf(approval),
    canDecide,
    canWithdraw: !isDecided(approval.status) && self,
  }
}

function subjectOf(approval: ApprovalRow): ApprovalSubject {
  if (approval.type === 'PURCHASE_ORDER') {
    return approval.entityId
      ? { kind: 'purchase_order', purchaseOrderId: approval.entityId }
      : { kind: 'other' }
  }
  if (approval.type === 'PRODUCT_CREATE') {
    return { kind: 'product', proposal: approval.payload as Record<string, unknown> }
  }
  return { kind: 'other' }
}
