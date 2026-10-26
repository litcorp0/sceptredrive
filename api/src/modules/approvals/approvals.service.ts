import type { DbExecutor, DbTransaction } from '@sceptre/db'
import { db } from '@sceptre/db'
import {
  type ApprovalAuthority,
  type ApprovalReasonCode,
  type ApprovalType,
  canDecideApproval,
  defaultApprovalAuthority,
  isDecided,
  isRole,
  type Role,
} from '@sceptre/shared'
import {
  assertBranchAccess,
  branchScope,
  hasPermission,
  resolveBranchFilter,
  roleOf,
} from '../../auth/scope.ts'
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
  SubjectLoader,
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
const SUBJECT_LOADERS = new Map<ApprovalType, SubjectLoader>()

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

/**
 * Registers the loader that renders one type's subject. Called by the owning
 * service at module load; a loader is read-only and never opens a transaction.
 */
export function registerSubjectLoader(type: ApprovalType, loader: SubjectLoader): void {
  SUBJECT_LOADERS.set(type, loader)
}

export function assertSubjectLoadersRegistered(required: readonly ApprovalType[]): void {
  const missing = required.filter((type) => !SUBJECT_LOADERS.has(type))
  if (missing.length > 0) {
    throw new Error(`No approval subject loader registered for: ${missing.join(', ')}`)
  }
}

/** Test seam, mirroring `registeredDecisionTypes`. */
export function registeredSubjectTypes(): ApprovalType[] {
  return [...SUBJECT_LOADERS.keys()]
}

export interface ApprovalRequestInput {
  type: ApprovalType
  entityId?: string | null
  branchId: string
  amountMinor?: number | null
  payload?: Record<string, unknown>
  note?: string | null
  /** Defaults from `defaultApprovalAuthority(type, branchId)`. */
  deciderRole?: Role
  /** Defaults to `branchId` when the role is `MANAGER`, and `null` for an admin. */
  deciderBranchId?: string | null
}

/** Called inside the requesting service's transaction. Returns the new approval. */
export async function requestApproval(
  actor: AuditActor,
  input: ApprovalRequestInput,
  executor: DbExecutor,
): Promise<ApprovalRow> {
  const authority = resolveAuthority(input)

  const created = await insertApproval(
    {
      type: input.type,
      entityId: input.entityId ?? null,
      branchId: input.branchId,
      requestedBy: actorLabel(actor) ?? 'unknown',
      deciderRole: authority.role,
      deciderBranchId: authority.branchId,
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

/**
 * The authority a new row is written with, and the one place the pairing is
 * checked.
 *
 * A `MANAGER` row without a branch, or an `ADMIN` row bound to one, is a
 * programming error in the calling service: it is refused as a 500 rather than
 * persisted as a row nobody — or everybody — can decide (P12-D2).
 */
function resolveAuthority(input: ApprovalRequestInput): ApprovalAuthority {
  const fallback = defaultApprovalAuthority(input.type, input.branchId)
  const role = input.deciderRole ?? fallback.role

  if (!isRole(role)) {
    throw new AppError(500, 'INTERNAL', `Unknown approval decider role: ${String(role)}`)
  }

  const branchId =
    input.deciderBranchId !== undefined
      ? input.deciderBranchId
      : role === 'MANAGER'
        ? input.branchId
        : null

  if (role === 'MANAGER' && branchId === null) {
    throw new AppError(500, 'INTERNAL', 'A manager decision needs the branch it belongs to')
  }
  if (role === 'ADMIN' && branchId !== null) {
    throw new AppError(500, 'INTERNAL', 'An admin decision is never bound to a branch')
  }

  return { role, branchId }
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
  if (!hasPermission(user, 'approval.decide')) {
    throw new ForbiddenError('You cannot decide this request')
  }
  if (input.decision === 'REJECTED' && !input.reasonCode) {
    throw new AppError(400, 'VALIDATION_ERROR', 'A rejection needs a reason code')
  }

  const decided = await db.transaction(async (tx) => {
    const current = await lockApprovalForUpdate(approvalId, tx)
    if (!current) throw new NotFoundError('Approval not found')

    // The decider must belong to the branch the row names, and the requester's
    // branch is the fallback. A transfer is raised at the destination and decided
    // by the source manager, so Phase 11's `current.branchId` would 403 them.
    assertBranchAccess(user, current.deciderBranchId ?? current.branchId)

    if (isDecided(current.status)) {
      throw new AppError(409, 'CONFLICT', 'This request has already been decided')
    }

    // One rule, shared with the console: pending, holds the permission, not the
    // requester, and either an admin or the manager of the branch named on the
    // row. The permission is checked at the route and again here (OWASP A01).
    if (!canDecideApproval({ approval: authorityOf(current), user: deciderOf(user, actor) })) {
      throw new ForbiddenError('You cannot decide this request')
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
  assertApprovalReadable(user, found)
  return buildDetail(user, actor, found)
}

/**
 * A manager reads their own branch's requests and the ones their branch must
 * decide; an admin reads every branch. Everything else is a 403 — the row
 * exists, and the caller is not allowed to know that (OWASP A01).
 */
function assertApprovalReadable(user: SessionUser, approval: ApprovalRow): void {
  const scope = branchScope(user)
  if (scope === null) return
  if (approval.branchId === scope) return
  if (approval.deciderBranchId !== null && approval.deciderBranchId === scope) return
  throw new ForbiddenError('You can only access your own branch')
}

async function buildDetail(
  user: SessionUser,
  actor: AuditActor,
  approval: ApprovalRow,
): Promise<ApprovalDetail> {
  const self = approval.requestedBy === (actorLabel(actor) ?? 'unknown')

  return {
    approval,
    subject: await loadSubject(approval),
    canDecide: canDecideApproval({
      approval: authorityOf(approval),
      user: deciderOf(user, actor),
    }),
    canWithdraw: !isDecided(approval.status) && self,
  }
}

/** The slice of the row `canDecideApproval` needs. */
function authorityOf(approval: ApprovalRow) {
  return {
    status: approval.status,
    deciderRole: approval.deciderRole as Role,
    deciderBranchId: approval.deciderBranchId,
    requestedBy: approval.requestedBy,
  }
}

/** The slice of the actor `canDecideApproval` needs. */
function deciderOf(user: SessionUser, actor: AuditActor) {
  return {
    role: roleOf(user),
    branchId: branchScope(user),
    label: actorLabel(actor) ?? 'unknown',
    hasDecidePermission: hasPermission(user, 'approval.decide'),
  }
}

/**
 * Runs the registered loader for this type. A missing loader is a 500: the boot
 * assertion catches it for every type Phase 12 creates, and this is the belt for
 * a type added later without one.
 */
async function loadSubject(approval: ApprovalRow): Promise<ApprovalSubject> {
  const loader = SUBJECT_LOADERS.get(approval.type)
  if (!loader) {
    throw new AppError(500, 'INTERNAL', `No subject loader for ${approval.type}`)
  }
  return loader(approval)
}
