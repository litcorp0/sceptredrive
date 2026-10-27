import { type DbExecutor, db } from '@sceptre/db'
import { ratioBp } from '@sceptre/shared'
import { branchScope, hasPermission, resolveBranchFilter, roleOf } from '../../auth/scope.ts'
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
  registerDecisionHandler,
  registerSubjectLoader,
  requestApproval,
} from '../approvals/approvals.service.ts'
import { requireCustomer } from '../customers/customers.service.ts'
import { getBranch, listBranches } from '../org/branches.service.ts'
import { writeAudit } from '../platform/audit.service.ts'
import type { AuditActor } from '../platform/audit.types.ts'
import { allocateFromSequence } from '../platform/settings.service.ts'
import {
  countEntryRows,
  countOverLimitProfiles,
  findEntryByIdempotencyKey,
  findProfile,
  findProfileById,
  insertEntry,
  listEntryRows,
  listOverLimitProfiles,
  listProfilesByBranch,
  listProfilesByCustomer,
  listSettlementEntries,
  listSettlementEntriesByBranch,
  lockOrCreateProfile,
  lockProfileById,
  sumEntriesBefore,
  sumForCustomerBranch,
  updateProfileBalance,
  updateProfileLimit,
  updateProfileSettings,
} from './credit.repository.ts'
import type {
  AgingBucketKey,
  AgingBuckets,
  AgingChargeRow,
  AgingQuery,
  AgingResult,
  BranchAging,
  ChargeSettlement,
  CreditEntryListResult,
  CreditLedgerEntryRow,
  CreditLimitChangeRequestResult,
  CreditLimitChangeSubject,
  CreditLimitChangeVia,
  CreditLimitPosition,
  CreditLimitRequestBody,
  CreditOverrideReason,
  CreditPostingResult,
  CreditProfileListResult,
  CreditProfileRow,
  CreditStatement,
  EntryCreateBody,
  EntryListQuery,
  OverLimitListResult,
  OverLimitQuery,
  PostEntryInput,
  ProfileListQuery,
  ProfileUpdateBody,
  RepaymentCreateBody,
  SettleableEntry,
  SettlementResult,
  StatementEntry,
  StatementQuery,
} from './credit.types.ts'
import {
  ADJUSTMENT_REASON_CODES,
  CHARGE_REASON_CODES,
  CREDIT_METHODS,
  creditLimitPayloadSchema,
} from './credit.validation.ts'

const AUDIT_ACTIONS = {
  CHARGE: 'credit.charge',
  REPAYMENT: 'credit.repayment',
  REFUND: 'credit.refund',
  ADJUSTMENT: 'credit.adjustment',
} as const

function formatMinor(minor: number): string {
  const sign = minor < 0 ? '-' : ''
  const absolute = Math.abs(minor)
  const cedis = Math.trunc(absolute / 100)
  const pesewas = String(absolute % 100).padStart(2, '0')
  return `${sign}GHS ${cedis}.${pesewas}`
}

/** UTC date `YYYY-MM-DD` shifted by whole days. */
function isoDate(date: Date, offsetDays = 0): string {
  const base = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + offsetDays)
  return new Date(base).toISOString().slice(0, 10)
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error
  let depth = 0
  while (current && typeof current === 'object' && depth < 5) {
    if ((current as { code?: unknown }).code === '23505') return true
    current = (current as { cause?: unknown }).cause
    depth += 1
  }
  return false
}

interface NormalizedEntry {
  reasonCode: PostEntryInput['reasonCode']
  method: PostEntryInput['method']
  dueDateOverride: string | null
  override: { reasonCode: CreditOverrideReason; note?: string | null } | null
}

/** Kind-specific rules for the single write path. */
function normalizeEntryInput(input: PostEntryInput): NormalizedEntry {
  if (!Number.isInteger(input.amountMinor) || input.amountMinor === 0) {
    throw new ValidationError('The amount must be a non-zero integer (minor units)')
  }

  if (input.kind === 'CHARGE') {
    if (input.amountMinor < 0) throw new ValidationError('A charge must be a positive amount')
    if (
      input.reasonCode === null ||
      input.reasonCode === undefined ||
      !CHARGE_REASON_CODES.includes(input.reasonCode as (typeof CHARGE_REASON_CODES)[number])
    ) {
      throw new ValidationError(
        'Charges require a reason: SALE, OPENING_BALANCE, CORRECTION, or OTHER',
      )
    }
    return {
      reasonCode: input.reasonCode,
      method: null,
      dueDateOverride: input.dueDate ? isoDate(input.dueDate) : null,
      override: input.override ?? null,
    }
  }

  if (input.kind === 'REPAYMENT') {
    if (input.amountMinor > 0) throw new ValidationError('A repayment must be a negative amount')
    if (
      input.method === null ||
      input.method === undefined ||
      !CREDIT_METHODS.includes(input.method as (typeof CREDIT_METHODS)[number])
    ) {
      throw new ValidationError('A repayment requires a method: CASH, MOMO, or BANK')
    }
    if (input.override) throw new ValidationError('Overrides only apply to charges')
    return {
      reasonCode: input.reasonCode ?? null,
      method: input.method,
      dueDateOverride: null,
      override: null,
    }
  }

  if (input.kind === 'REFUND') {
    if (input.amountMinor > 0) throw new ValidationError('A refund must be a negative amount')
    if (input.override) throw new ValidationError('Overrides only apply to charges')
    return {
      reasonCode: 'RETURN',
      method: input.method ?? null,
      dueDateOverride: null,
      override: null,
    }
  }

  if (
    input.reasonCode === null ||
    input.reasonCode === undefined ||
    !ADJUSTMENT_REASON_CODES.includes(input.reasonCode as (typeof ADJUSTMENT_REASON_CODES)[number])
  ) {
    throw new ValidationError(
      'Adjustments require a reason: CORRECTION, WRITE_OFF, DISPUTE, or OTHER',
    )
  }
  if (input.override) throw new ValidationError('Overrides only apply to charges')
  return { reasonCode: input.reasonCode, method: null, dueDateOverride: null, override: null }
}

/**
 * The single credit write path. Every kind posts through here: it locks the
 * profile, applies kind-specific rules and limit/hold enforcement, allocates
 * references, writes the append-only entry, projects the balance, and audits.
 * Idempotent by `(branchId, idempotencyKey)`.
 */
export async function postEntry(
  actor: AuditActor,
  user: SessionUser,
  input: PostEntryInput,
): Promise<CreditPostingResult> {
  const normalized = normalizeEntryInput(input)

  if (input.idempotencyKey) {
    const existing = await findEntryByIdempotencyKey(input.branchId, input.idempotencyKey)
    if (existing) {
      const profile = await findProfile(input.customerId, input.branchId)
      if (profile) return { entry: existing, profile }
    }
  }

  const customerRow = await requireCustomer(input.customerId)
  if (customerRow.anonymizedAt) {
    throw new ConflictError('Anonymized customers cannot receive credit entries')
  }
  if (input.kind === 'CHARGE' && customerRow.status !== 'ACTIVE') {
    throw new ConflictError('Archived customers cannot be charged new credit')
  }

  await getBranch(user, input.branchId)

  try {
    return await db.transaction((tx) => postEntryInTransaction(tx, actor, user, input, normalized))
  } catch (error) {
    if (input.idempotencyKey && isUniqueViolation(error)) {
      const existing = await findEntryByIdempotencyKey(input.branchId, input.idempotencyKey)
      if (existing) {
        const profile = await findProfile(input.customerId, input.branchId)
        if (profile) return { entry: existing, profile }
      }
    }
    throw error
  }
}

/**
 * Transaction-scoped credit posting.
 *
 * The POS sale transaction calls this so the credit ledger, sale rows, stock
 * movements, and audit commit atomically. `user` is null only on that path:
 * device authentication already authorized the branch, and `bypassPolicy`
 * makes the hold/limit checks (which need a role) irrelevant. Policy is bypassed
 * so an offline over-limit debt is still recorded; the caller raises the
 * conflict and any approval audit.
 */
export interface CreditTxContext {
  /**
   * The already-validated approver when a POS override is recorded. The POS
   * validates the manager binding itself (D22) and passes the approver here so
   * the ledger and the `credit.override` audit name the approver, not the till.
   */
  overrideActor?: AuditActor
}

export async function postEntryInTransaction(
  tx: DbExecutor,
  actor: AuditActor,
  user: SessionUser | null,
  input: PostEntryInput,
  normalizedInput?: ReturnType<typeof normalizeEntryInput>,
  context: CreditTxContext = {},
): Promise<CreditPostingResult> {
  const normalized = normalizedInput ?? normalizeEntryInput(input)
  const occurredAt = input.occurredAt ?? new Date()

  // The upload reservation normally stops a replay; this is the second guard
  // for the same client transaction.
  if (input.idempotencyKey) {
    const existing = await findEntryByIdempotencyKey(input.branchId, input.idempotencyKey, tx)
    if (existing) {
      const profile = await findProfile(input.customerId, input.branchId, tx)
      if (profile) return { entry: existing, profile }
    }
  }

  const customerRow = await requireCustomer(input.customerId, tx)
  if (customerRow.anonymizedAt) {
    throw new ConflictError('Anonymized customers cannot receive credit entries')
  }
  if (input.kind === 'CHARGE' && customerRow.status !== 'ACTIVE') {
    throw new ConflictError('Archived customers cannot be charged new credit')
  }

  const profile = await lockOrCreateProfile(tx, input.customerId, input.branchId)

  let overrideReason: CreditOverrideReason | null = null
  if (input.kind === 'CHARGE') {
    if (!input.bypassPolicy) {
      if (!user) {
        throw new ForbiddenError('Credit policy enforcement requires an authenticated user')
      }
      if (profile.hold) {
        throw new ConflictError('Credit is on hold at this branch')
      }
      if (profile.balanceMinor + input.amountMinor > profile.limitMinor) {
        if (!normalized.override) {
          throw new ConflictError(
            `This charge exceeds the credit limit (balance ${formatMinor(profile.balanceMinor)}, limit ${formatMinor(profile.limitMinor)})`,
          )
        }
        if (!hasPermission(user, 'credit.override')) {
          throw new ForbiddenError('You do not have permission to override the credit limit')
        }
        overrideReason = normalized.override.reasonCode
      }
    }
    // The POS path bypasses enforcement but may still carry a validated
    // approval, which must be recorded on the ledger entry and in the audit.
    if (normalized.override && (overrideReason !== null || input.bypassPolicy)) {
      overrideReason = normalized.override.reasonCode
    }
  }

  const dueDate =
    input.kind === 'CHARGE'
      ? (normalized.dueDateOverride ?? isoDate(occurredAt, profile.paymentTermDays))
      : null

  // A repayment may arrive with the number the till already printed offline: the
  // customer is holding that receipt, so the ledger keeps it rather than minting
  // a second one (P13-D27). The console passes none and still gets a number.
  let referenceNumber = input.referenceNumber ?? null
  if (input.kind === 'REPAYMENT' && !referenceNumber) {
    referenceNumber = await allocateFromSequence('credit.repaymentSequence', tx)
  }

  const recordedBy = actorLabel(actor) ?? actor.actorId
  const overrideBy = context.overrideActor ?? actor
  const overrideRecordedBy = actorLabel(overrideBy) ?? overrideBy.actorId
  const entry = await insertEntry(
    {
      customerId: input.customerId,
      branchId: input.branchId,
      kind: input.kind,
      amountMinor: input.amountMinor,
      reasonCode: normalized.reasonCode,
      method: normalized.method,
      note: input.note ?? null,
      dueDate,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      referenceNumber,
      overrideReason,
      overriddenBy: overrideReason ? overrideRecordedBy : null,
      receivedBy: input.kind === 'REPAYMENT' || input.kind === 'REFUND' ? recordedBy : null,
      idempotencyKey: input.idempotencyKey ?? null,
      createdBy: recordedBy,
      occurredAt,
    },
    tx,
  )
  if (!entry) throw new AppError(500, 'INTERNAL', 'Failed to write the credit entry')

  const nextBalance = profile.balanceMinor + input.amountMinor
  await updateProfileBalance(profile.id, nextBalance, tx)

  await writeAudit(
    {
      ...actor,
      action: AUDIT_ACTIONS[input.kind],
      entity: 'credit_ledger_entry',
      entityId: entry.id,
      branchId: input.branchId,
      after: {
        kind: entry.kind,
        amountMinor: entry.amountMinor,
        reasonCode: entry.reasonCode,
        method: entry.method,
        referenceNumber: entry.referenceNumber,
        dueDate: entry.dueDate,
        balanceMinor: nextBalance,
      },
    },
    tx,
  )

  if (overrideReason && normalized.override) {
    await writeAudit(
      {
        ...overrideBy,
        action: 'credit.override',
        entity: 'credit_ledger_entry',
        entityId: entry.id,
        branchId: input.branchId,
        after: {
          reasonCode: overrideReason,
          note: normalized.override.note ?? null,
          amountMinor: entry.amountMinor,
          limitMinor: profile.limitMinor,
          balanceBeforeMinor: profile.balanceMinor,
        },
      },
      tx,
    )
  }

  return { entry, profile: { ...profile, balanceMinor: nextBalance } }
}

function compareSettleable(a: SettleableEntry, b: SettleableEntry): number {
  const byOccurred = a.occurredAt.getTime() - b.occurredAt.getTime()
  if (byOccurred !== 0) return byOccurred
  const byCreated = a.createdAt.getTime() - b.createdAt.getTime()
  if (byCreated !== 0) return byCreated
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * Oldest-first settlement: negative entries (repayments, refunds, negative
 * adjustments) pay down charges in `occurredAt` order. Pure function used by
 * aging and statements; nothing is stored.
 */
export function settleCharges(entries: SettleableEntry[]): SettlementResult {
  const ordered = [...entries].sort(compareSettleable)
  const charges: ChargeSettlement[] = []
  const credits: number[] = []

  for (const entry of ordered) {
    const isCharge =
      entry.kind === 'CHARGE' || (entry.kind === 'ADJUSTMENT' && entry.amountMinor > 0)
    if (isCharge && entry.amountMinor > 0) {
      charges.push({
        entryId: entry.id,
        occurredAt: entry.occurredAt,
        dueDate: entry.dueDate ?? isoDate(entry.occurredAt),
        amountMinor: entry.amountMinor,
        outstandingMinor: entry.amountMinor,
      })
    } else if (entry.amountMinor < 0) {
      credits.push(-entry.amountMinor)
    }
  }

  let next = 0
  let remaining = 0
  for (const charge of charges) {
    while (charge.outstandingMinor > 0 && (remaining > 0 || next < credits.length)) {
      if (remaining === 0) {
        remaining = credits[next] ?? 0
        next += 1
      }
      const applied = Math.min(remaining, charge.outstandingMinor)
      charge.outstandingMinor -= applied
      remaining -= applied
    }
  }

  const unappliedCreditMinor =
    remaining + credits.slice(next).reduce((sum, value) => sum + value, 0)

  return { charges, unappliedCreditMinor }
}

/**
 * Profile settings are a separate, audited path — never the balance.
 *
 * A limit change is an authority question, not a shape question, so the rule
 * lives here and only here (P12-D21): a manager may lower a limit (that reduces
 * exposure) and is refused an increase with a 403 naming the request endpoint; an
 * admin changes a limit directly. `hold`, `paymentTermDays` and `notes` do not
 * increase exposure and stay direct for both. A client that hides the field must
 * still hit this 403 if it sends one (OWASP A01).
 */
export async function updateProfile(
  actor: AuditActor,
  user: SessionUser,
  customerId: string,
  input: ProfileUpdateBody,
): Promise<CreditProfileRow> {
  const branchId = resolveBranchFilter(user, input.branchId ?? null)
  if (!branchId) {
    throw new ValidationError('branchId is required when an admin updates a credit profile')
  }
  await getBranch(user, branchId)
  await requireCustomer(customerId)

  return db.transaction(async (tx): Promise<CreditProfileRow> => {
    const profile = await lockOrCreateProfile(tx, customerId, branchId)

    const patch: Partial<typeof profile> = {}
    let limitVia: CreditLimitChangeVia | null = null
    if (input.limitMinor !== undefined && input.limitMinor !== profile.limitMinor) {
      const raising = input.limitMinor > profile.limitMinor
      if (raising && roleOf(user) !== 'ADMIN') {
        throw new ForbiddenError(
          'A credit limit increase is requested and approved. Use Request limit increase.',
        )
      }
      limitVia = raising || roleOf(user) === 'ADMIN' ? 'DIRECT' : 'DIRECT_DECREASE'
      patch.limitMinor = input.limitMinor
    }
    if (input.hold !== undefined) patch.hold = input.hold
    if (input.paymentTermDays !== undefined) patch.paymentTermDays = input.paymentTermDays
    if (input.notes !== undefined) patch.notes = input.notes ?? null

    const updated =
      Object.keys(patch).length > 0 ? await updateProfileSettings(profile.id, patch, tx) : profile
    if (!updated) throw new AppError(500, 'INTERNAL', 'Failed to update the credit profile')

    await writeAudit(
      {
        ...actor,
        action: 'credit.profile_updated',
        entity: 'credit_profile',
        entityId: profile.id,
        branchId,
        before: {
          limitMinor: profile.limitMinor,
          hold: profile.hold,
          paymentTermDays: profile.paymentTermDays,
          notes: profile.notes,
        },
        after: {
          limitMinor: updated.limitMinor,
          hold: updated.hold,
          paymentTermDays: updated.paymentTermDays,
          notes: updated.notes,
          // Null when this update did not move the limit. `DIRECT` is an admin,
          // `DIRECT_DECREASE` a manager lowering exposure (P12-D21), `approval`
          // is written by the decision handler below.
          via: limitVia,
        },
      },
      tx,
    )

    return updated
  })
}

/**
 * A manager asks an admin to raise a limit (P12-D21, P12-D22).
 *
 * The profile is locked (and created at limit 0 when this customer has none at
 * the branch) *before* the request is valued, so `currentLimitMinor` is the limit
 * the admin will be asked to replace, not a value read from somewhere else. The
 * request stores the profile id as its entity: that is what makes the partial
 * unique index mean "one pending limit change per customer per branch" — the same
 * customer's limit at another branch is a different decision.
 */
export async function requestCreditLimitIncrease(
  user: SessionUser,
  actor: AuditActor,
  customerId: string,
  input: CreditLimitRequestBody,
): Promise<CreditLimitChangeRequestResult> {
  // P12-D3: an admin never raises a request for work an admin can do directly.
  if (roleOf(user) === 'ADMIN') {
    throw new ValidationError(
      'An admin changes a credit limit directly (PUT /api/credit/profiles/:customerId)',
    )
  }

  const branchId = branchScope(user)
  if (!branchId) throw new ValidationError('Your account is not assigned to a branch')
  await getBranch(user, branchId)
  await requireCustomer(customerId)

  try {
    return await db.transaction(async (tx): Promise<CreditLimitChangeRequestResult> => {
      const profile = await lockOrCreateProfile(tx, customerId, branchId)

      if (input.proposedLimitMinor <= profile.limitMinor) {
        throw new ValidationError(
          'A limit increase must be greater than the current limit; a decrease applies immediately',
        )
      }

      const approval = await requestApproval(
        actor,
        {
          type: 'CREDIT_LIMIT_CHANGE',
          entityId: profile.id,
          branchId,
          amountMinor: input.proposedLimitMinor,
          deciderRole: 'ADMIN',
          deciderBranchId: null,
          note: input.reason,
          payload: {
            customerId,
            branchId,
            currentLimitMinor: profile.limitMinor,
            proposedLimitMinor: input.proposedLimitMinor,
            balanceMinor: profile.balanceMinor,
          },
        },
        tx,
      )

      await writeAudit(
        {
          ...actor,
          action: 'credit.limit_change_requested',
          entity: 'credit_profile',
          entityId: profile.id,
          branchId,
          before: {
            limitMinor: profile.limitMinor,
            balanceMinor: profile.balanceMinor,
          },
          after: {
            limitMinor: input.proposedLimitMinor,
            balanceMinor: profile.balanceMinor,
            approvalId: approval.id,
            reason: input.reason,
          },
        },
        tx,
      )

      return { approvalId: approval.id, status: 'PENDING' as const }
    })
  } catch (error) {
    // The partial unique index on (type, entity_id) WHERE status = 'PENDING' is
    // the guard, not a pre-check: two concurrent submits cannot both queue.
    if (isUniqueViolation(error)) {
      throw new ConflictError(
        'A credit limit change for this customer is already waiting for an admin decision',
      )
    }
    throw error
  }
}

function requirePostingBranch(user: SessionUser, requested: string | null | undefined): string {
  const branchId = resolveBranchFilter(user, requested ?? null)
  if (!branchId) throw new ValidationError('branchId is required to post a credit entry')
  return branchId
}

/** Repayments are posted positive at the API edge and stored negative. */
export async function createRepayment(
  actor: AuditActor,
  user: SessionUser,
  input: RepaymentCreateBody,
): Promise<CreditPostingResult> {
  return postEntry(actor, user, {
    customerId: input.customerId,
    branchId: requirePostingBranch(user, input.branchId),
    kind: 'REPAYMENT',
    amountMinor: input.amountMinor,
    method: input.method,
    note: input.note ?? null,
    occurredAt: input.occurredAt,
    idempotencyKey: input.idempotencyKey ?? null,
  })
}

/** CHARGE / REFUND / ADJUSTMENT postings from the console and POS. */
export async function createEntry(
  actor: AuditActor,
  user: SessionUser,
  input: EntryCreateBody,
): Promise<CreditPostingResult> {
  return postEntry(actor, user, {
    customerId: input.customerId,
    branchId: requirePostingBranch(user, input.branchId),
    kind: input.kind,
    amountMinor: input.amountMinor,
    reasonCode: input.reasonCode ?? null,
    note: input.note ?? null,
    occurredAt: input.occurredAt,
    dueDate: input.dueDate ?? null,
    referenceType: input.referenceType ?? null,
    referenceId: input.referenceId ?? null,
    referenceNumber: input.referenceNumber ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
    override: input.override ?? null,
  })
}

/** A date-only boundary (`midnight UTC`) means the whole day, inclusive. */
function inclusiveEnd(date: Date): Date {
  const isMidnight =
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0
  return isMidnight ? new Date(date.getTime() + 86_400_000 - 1) : date
}

export async function listProfiles(
  user: SessionUser,
  query: ProfileListQuery,
): Promise<CreditProfileListResult> {
  const branchId = resolveBranchFilter(user, query.branchId ?? null)
  if (query.customerId) {
    return { profiles: await listProfilesByCustomer(query.customerId, branchId) }
  }
  if (!branchId) throw new ValidationError('branchId is required')
  return { profiles: await listProfilesByBranch(branchId) }
}

export async function listEntries(
  user: SessionUser,
  query: EntryListQuery,
): Promise<CreditEntryListResult> {
  const branchId = resolveBranchFilter(user, query.branchId ?? null)
  const filters = {
    customerId: query.customerId,
    branchId,
    kind: query.kind,
    from: query.from,
    to: query.to ? inclusiveEnd(query.to) : undefined,
  }

  const [entries, total] = await Promise.all([
    listEntryRows({
      ...filters,
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
      newestFirst: true,
    }),
    countEntryRows(filters),
  ])

  return { entries, total, page: query.page, pageSize: query.pageSize }
}

const AGING_BUCKET_KEYS = ['current', 'days1To30', 'days31To60', 'days61To90', 'over90'] as const

function emptyBuckets(): AgingBuckets {
  return { current: 0, days1To30: 0, days31To60: 0, days61To90: 0, over90: 0 }
}

function utcMidnight(isoDay: string): number {
  const [year, month, day] = isoDay.split('-').map(Number)
  return Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1)
}

/** Fixed buckets from the due date; due today or in the future is Current. */
function chargeAging(
  dueDate: string,
  asOf: string,
): { daysPastDue: number; bucket: AgingBucketKey } {
  const daysPastDue = Math.floor((utcMidnight(asOf) - utcMidnight(dueDate)) / 86_400_000)
  if (daysPastDue > 90) return { daysPastDue, bucket: 'over90' }
  if (daysPastDue > 60) return { daysPastDue, bucket: 'days61To90' }
  if (daysPastDue > 30) return { daysPastDue, bucket: 'days31To60' }
  if (daysPastDue > 0) return { daysPastDue, bucket: 'days1To30' }
  return { daysPastDue, bucket: 'current' }
}

/**
 * Aging report: for every customer with a profile at the branch and a
 * non-zero outstanding, per-charge buckets derived from settlement. Managers
 * see their own branch; admins see one branch or all branches separately.
 */
export async function getAging(user: SessionUser, query: AgingQuery): Promise<AgingResult> {
  const asOf = isoDate(query.asOf ?? new Date())
  const requested = resolveBranchFilter(user, query.branchId ?? null)

  const targets = requested
    ? [await getBranch(user, requested)]
    : await listBranches(user, { includeInactive: false })

  const branches: BranchAging[] = []
  for (const target of targets) {
    const branch: BranchAging = {
      branch: { id: target.id, code: target.code, name: target.name },
      customers: [],
      totals: { ...emptyBuckets(), total: 0 },
    }

    const profiles = await listProfilesByBranch(target.id)
    if (profiles.length > 0) {
      const entries = await listSettlementEntriesByBranch(target.id)
      const byCustomer = new Map<string, CreditLedgerEntryRow[]>()
      for (const entry of entries) {
        const list = byCustomer.get(entry.customerId)
        if (list) list.push(entry)
        else byCustomer.set(entry.customerId, [entry])
      }

      for (const profile of profiles) {
        const settlement = settleCharges(byCustomer.get(profile.customerId) ?? [])
        const buckets = emptyBuckets()
        let total = 0
        let oldestDueDate: string | null = null

        for (const charge of settlement.charges) {
          if (charge.outstandingMinor === 0) continue
          const { bucket } = chargeAging(charge.dueDate, asOf)
          buckets[bucket] += charge.outstandingMinor
          total += charge.outstandingMinor
          if (!oldestDueDate || charge.dueDate < oldestDueDate) oldestDueDate = charge.dueDate
        }

        if (total === 0) continue
        branch.customers.push({
          customerId: profile.customerId,
          customerName: profile.customerName,
          branchId: target.id,
          buckets,
          totalMinor: total,
          oldestDueDate,
        })
        for (const key of AGING_BUCKET_KEYS) branch.totals[key] += buckets[key]
        branch.totals.total += total
      }
    }

    branches.push(branch)
  }

  return { asOf, branches }
}

/**
 * Printable statement data (printing is the console's concern): opening
 * balance, ranged entries, closing balance that equals the profile balance,
 * and an aging snapshot as of `to`.
 */
export async function getStatement(
  user: SessionUser,
  customerId: string,
  query: StatementQuery,
): Promise<CreditStatement> {
  const branchId = resolveBranchFilter(user, query.branchId ?? null)
  if (!branchId)
    throw new ValidationError('branchId is required when an admin requests a statement')
  const branchRow = await getBranch(user, branchId)

  const profile = await findProfile(customerId, branchId)
  if (!profile) throw new NotFoundError('No credit profile exists for this customer at this branch')
  const customerRow = await requireCustomer(customerId)

  const from = query.from ?? null
  const to = query.to ? inclusiveEnd(query.to) : new Date()

  const [openingBalanceMinor, rangedSum, rangedEntries] = await Promise.all([
    from ? sumEntriesBefore(customerId, branchId, from) : Promise.resolve(0),
    sumForCustomerBranch(customerId, branchId, { from: from ?? undefined, to }),
    // Statements are per customer; one generous page covers the full ledger.
    listEntryRows({
      customerId,
      branchId,
      from: from ?? undefined,
      to,
      limit: 5000,
      offset: 0,
      newestFirst: false,
    }),
  ])

  const toDay = isoDate(to)
  const allEntries = await listSettlementEntries(customerId, branchId)
  const upTo = allEntries.filter((entry) => entry.occurredAt.getTime() <= to.getTime())
  const settlement = settleCharges(upTo)
  const aging: AgingChargeRow[] = settlement.charges
    .filter((charge) => charge.outstandingMinor > 0)
    .map((charge) => {
      const { daysPastDue, bucket } = chargeAging(charge.dueDate, toDay)
      return {
        entryId: charge.entryId,
        occurredAt: charge.occurredAt,
        dueDate: charge.dueDate,
        amountMinor: charge.amountMinor,
        outstandingMinor: charge.outstandingMinor,
        daysPastDue,
        bucket,
      }
    })

  const entries: StatementEntry[] = rangedEntries.map((entry) => ({
    id: entry.id,
    kind: entry.kind,
    occurredAt: entry.occurredAt,
    dueDate: entry.dueDate,
    amountMinor: entry.amountMinor,
    referenceType: entry.referenceType,
    referenceNumber: entry.referenceNumber,
    reasonCode: entry.reasonCode,
    method: entry.method,
    note: entry.note,
    createdBy: entry.createdBy,
  }))

  return {
    customer: { id: customerRow.id, name: customerRow.name, phone: customerRow.phone },
    branch: { id: branchRow.id, code: branchRow.code, name: branchRow.name },
    from: from ? isoDate(from) : null,
    to: toDay,
    openingBalanceMinor,
    entries,
    closingBalanceMinor: openingBalanceMinor + rangedSum,
    currentBalanceMinor: profile.balanceMinor,
    aging,
  }
}

/**
 * The manager's over-limit list: the rows behind analytics' count (P12-D23).
 *
 * The predicate is analytics' predicate — `limit_minor > 0 AND balance_minor >
 * limit_minor` — so a dashboard tile and the list it opens can never disagree;
 * the parity test in `credit.test.ts` holds the two together. Branch scoping
 * happens twice, as P11-D17 requires: the route demands `credit.read` and this
 * function runs `resolveBranchFilter`, which refuses a manager asking for another
 * branch with a 403.
 */
export async function listOverLimit(
  user: SessionUser,
  query: OverLimitQuery,
): Promise<OverLimitListResult> {
  const branchId = resolveBranchFilter(user, query.branchId ?? null)
  const [customers, total] = await Promise.all([
    listOverLimitProfiles({ branchId, limit: query.limit, offset: query.offset }),
    countOverLimitProfiles(branchId),
  ])
  return { customers, total, branchId }
}

/** Where the customer stands at a given limit — headroom or the excess. */
function limitPosition(limitMinor: number, balanceMinor: number): CreditLimitPosition {
  const overByMinor = balanceMinor > limitMinor ? balanceMinor - limitMinor : 0
  return {
    limitMinor,
    balanceMinor,
    overByMinor,
    headroomMinor: limitMinor > balanceMinor ? limitMinor - balanceMinor : 0,
    // Same shape as the over-limit list, without the `limit > 0` arm: the
    // position is about this proposal, so a zero limit with a debt is over it.
    overLimit: balanceMinor > limitMinor,
    blocksNewCredit: balanceMinor >= limitMinor,
  }
}

/**
 * Plan 07's half of the decision registry (P12-D8).
 *
 * A limit is an entitlement, not money owed: this writes `limit_minor` and an
 * audit row, and **no** ledger entry — `balance_minor` stays a projection of
 * `credit_ledger_entry` and is untouched here. The stale check is P12-D22: the
 * profile is locked and its limit must still equal the value the request was
 * valued against, or the decision fails with a 409 and rolls back (the approval
 * stays `PENDING` so the admin can reject it).
 *
 * `REJECTED` is handled before the payload is parsed, as in `PRODUCT_CREATE`: an
 * admin must always be able to reject a request whose stored payload is
 * unreadable, and a rejection writes nothing to the subject.
 */
registerDecisionHandler('CREDIT_LIMIT_CHANGE', async (tx, approval, actor, decision) => {
  if (decision === 'REJECTED') return undefined

  if (!approval.entityId) {
    throw new AppError(500, 'INTERNAL', 'A credit limit approval has no credit profile')
  }
  const payload = creditLimitPayloadSchema.parse(approval.payload)

  const profile = await lockProfileById(approval.entityId, tx)
  if (!profile) throw new NotFoundError('Credit profile not found')
  if (profile.limitMinor !== payload.currentLimitMinor) {
    throw new ConflictError(
      'The limit changed while this request was waiting. Reject it and raise a new one.',
    )
  }

  const updated = await updateProfileLimit(profile.id, payload.proposedLimitMinor, tx)
  if (!updated) throw new AppError(500, 'INTERNAL', 'Failed to update the credit profile')

  const via: CreditLimitChangeVia = 'approval'

  await writeAudit(
    {
      ...actor,
      action: 'credit.profile_updated',
      entity: 'credit_profile',
      entityId: profile.id,
      branchId: profile.branchId,
      before: { limitMinor: profile.limitMinor },
      after: {
        limitMinor: payload.proposedLimitMinor,
        via,
        approvalId: approval.id,
      },
    },
    tx,
  )

  return undefined
})

/**
 * Plan 07's half of the subject registry (P12-D4): the admin sees the current
 * limit, the proposed one, the balance and the resulting position — including the
 * case where the approved limit still leaves the customer over it, which P12-D21
 * allows and which must be visible now rather than discovered at the next sale.
 * Read-only and transaction-free.
 */
registerSubjectLoader('CREDIT_LIMIT_CHANGE', async (approval) => {
  if (!approval.entityId) return { kind: 'other' }

  const profile = await findProfileById(approval.entityId)
  if (!profile) throw new NotFoundError('Credit profile not found')
  const customerRow = await requireCustomer(profile.customerId)

  // The request captured the limit it was valued against; the profile carries the
  // live balance. A payload that cannot be read (an older row, a hand-edited
  // value) falls back to the profile so the decider can still see and reject it
  // rather than facing a 500 on the detail screen.
  const payload = creditLimitPayloadSchema.safeParse(approval.payload)
  const currentLimitMinor = payload.success ? payload.data.currentLimitMinor : profile.limitMinor
  const proposedLimitMinor = payload.success
    ? payload.data.proposedLimitMinor
    : (approval.amountMinor ?? profile.limitMinor)

  const subject: CreditLimitChangeSubject = {
    kind: 'credit_limit_change',
    customerId: profile.customerId,
    branchId: profile.branchId,
    currentLimitMinor,
    proposedLimitMinor,
    balanceMinor: profile.balanceMinor,
    customerName: customerRow.name,
    phone: customerRow.phone,
    utilisationBp: ratioBp(profile.balanceMinor, proposedLimitMinor),
    resultingPosition: limitPosition(proposedLimitMinor, profile.balanceMinor),
  }
  return subject
})
