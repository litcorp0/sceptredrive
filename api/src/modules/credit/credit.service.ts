import { db } from '@gikautos/db'
import { hasPermission, resolveBranchFilter } from '../../auth/scope.ts'
import { actorLabel } from '../../http/audit-context.ts'
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../http/errors.ts'
import type { SessionUser } from '../../http/factory.ts'
import { requireCustomer } from '../customers/customers.service.ts'
import { getBranch, listBranches } from '../org/branches.service.ts'
import { writeAudit } from '../platform/audit.service.ts'
import type { AuditActor } from '../platform/audit.types.ts'
import { allocateFromSequence } from '../platform/settings.service.ts'
import {
  countEntryRows,
  findEntryByIdempotencyKey,
  findProfile,
  insertEntry,
  listEntryRows,
  listProfilesByBranch,
  listProfilesByCustomer,
  listSettlementEntries,
  listSettlementEntriesByBranch,
  lockOrCreateProfile,
  sumEntriesBefore,
  sumForCustomerBranch,
  updateProfileBalance,
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
  CreditOverrideReason,
  CreditPostingResult,
  CreditProfileListResult,
  CreditProfileRow,
  CreditStatement,
  EntryCreateBody,
  EntryListQuery,
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

  const occurredAt = input.occurredAt ?? new Date()

  try {
    return await db.transaction(async (tx): Promise<CreditPostingResult> => {
      const profile = await lockOrCreateProfile(tx, input.customerId, input.branchId)

      let overrideReason: CreditOverrideReason | null = null
      if (input.kind === 'CHARGE') {
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

      const dueDate =
        input.kind === 'CHARGE'
          ? (normalized.dueDateOverride ?? isoDate(occurredAt, profile.paymentTermDays))
          : null

      let referenceNumber = input.referenceNumber ?? null
      if (input.kind === 'REPAYMENT') {
        referenceNumber = await allocateFromSequence('credit.repaymentSequence', tx)
      }

      const recordedBy = actorLabel(actor) ?? actor.actorId
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
          overriddenBy: overrideReason ? recordedBy : null,
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
            ...actor,
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
    })
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

/** Profile settings are a separate, audited path — never the balance. */
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
    if (input.limitMinor !== undefined) patch.limitMinor = input.limitMinor
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
        },
      },
      tx,
    )

    return updated
  })
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
