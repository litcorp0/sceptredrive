import { type DbExecutor, db } from '@sceptre/db'
import { accraIsoDay, toCsv } from '@sceptre/shared'
import { resolveBranchFilter } from '../../auth/scope.ts'
import { actorLabel } from '../../http/audit-context.ts'
import { type CsvExport, csvFilename, enforceExportCap } from '../../http/csv.ts'
import { AppError, ConflictError, NotFoundError, ValidationError } from '../../http/errors.ts'
import type { SessionUser } from '../../http/factory.ts'
import { requireCustomer } from '../customers/customers.service.ts'
import { listBranches } from '../org/branches.service.ts'
import { writeAudit } from '../platform/audit.service.ts'
import type { AuditActor } from '../platform/audit.types.ts'
import { getSettingValue } from '../platform/settings.service.ts'
import {
  appendConsumption,
  branchActivity,
  countEntries,
  findAccountByCustomerId,
  findEntryByIdempotencyKey,
  insertAccountForCustomer,
  insertEntry,
  insertLot,
  listAccountBalances,
  listAccountIdsWithExpiredLots,
  listEntries,
  listLots,
  listNegativeBalances,
  lockAccountById,
  lockExpiredLotsFefo,
  lockLotsFefo,
  lockOrCreateAccount,
  sumConsumedByAccount,
  sumEntriesByAccount,
  sumExpiringPoints,
  sumLotRemainingByAccount,
  sumOutstanding,
  updateAccountBalance,
  updateLotRemaining,
} from './loyalty.repository.ts'
import type {
  ExpiryRunResult,
  LiabilityQuery,
  LoyaltyAccountDetail,
  LoyaltyAccountRow,
  LoyaltyEntryCreateBody,
  LoyaltyLedgerEntryRow,
  LoyaltyLiabilityReport,
  LoyaltyLotConsumptionRow,
  LoyaltyLotRow,
  LoyaltyPostEntryInput,
  LoyaltyPostingResult,
  LoyaltyReasonCode,
  LoyaltyReconciliationDivergence,
  RedeemQuote,
} from './loyalty.types.ts'
import { LOYALTY_ADJUST_REASON_CODES } from './loyalty.validation.ts'

const AUDIT_ACTIONS = {
  EARN: 'loyalty.earned',
  REDEEM: 'loyalty.redeemed',
  CLAWBACK: 'loyalty.clawback',
  ADJUST: 'loyalty.adjusted',
} as const

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

/** Calendar-month shift in UTC, mirroring how lots were first seeded. */
function addMonths(date: Date, months: number): Date {
  const result = new Date(date)
  result.setUTCMonth(result.getUTCMonth() + months)
  return result
}

/** Points earned by a sale: floor(GHS × rate), no carry (D15). */
export async function earnPointsForSale(netPaidMinor: number): Promise<number> {
  const rate = await getSettingValue('loyalty.earnPointsPerCedi', {})
  return Math.floor((netPaidMinor * rate) / 100)
}

/** Redemption value in pesewas for the POS/console to display. */
export async function quoteRedeem(points: number, executor: DbExecutor = db): Promise<RedeemQuote> {
  const pointsPerCedi = await getSettingValue('loyalty.pointsPerCedi', {}, executor)
  return { points, discountMinor: Math.floor((points * 100) / pointsPerCedi) }
}

interface NormalizedPosting {
  pointsDelta: number
  reasonCode: LoyaltyReasonCode | null
  netPaidMinor: number | null
}

/** Kind-specific rules for the single write path. */
function normalizePosting(input: LoyaltyPostEntryInput): NormalizedPosting {
  if (input.kind === 'EARN') {
    if (
      input.netPaidMinor === undefined ||
      !Number.isInteger(input.netPaidMinor) ||
      input.netPaidMinor < 1
    ) {
      throw new ValidationError('EARN requires the net amount paid in minor units')
    }
    if (input.pointsDelta !== undefined) {
      throw new ValidationError('EARN points are computed from the amount paid')
    }
    return {
      pointsDelta: 0,
      reasonCode: input.reasonCode ?? null,
      netPaidMinor: input.netPaidMinor,
    }
  }

  const delta = input.pointsDelta
  if (delta === undefined || !Number.isInteger(delta) || delta === 0) {
    throw new ValidationError('Points must be a non-zero integer')
  }

  if (input.kind === 'REDEEM') {
    if (delta > 0) throw new ValidationError('A redemption must be posted as negative points')
    return { pointsDelta: delta, reasonCode: input.reasonCode ?? null, netPaidMinor: null }
  }

  if (input.kind === 'CLAWBACK') {
    if (delta > 0) throw new ValidationError('A clawback must be posted as negative points')
    if (
      input.reasonCode !== undefined &&
      input.reasonCode !== null &&
      input.reasonCode !== 'RETURN'
    ) {
      throw new ValidationError('A clawback is always reason RETURN')
    }
    return { pointsDelta: delta, reasonCode: 'RETURN', netPaidMinor: null }
  }

  if (
    input.reasonCode === undefined ||
    input.reasonCode === null ||
    !LOYALTY_ADJUST_REASON_CODES.includes(
      input.reasonCode as (typeof LOYALTY_ADJUST_REASON_CODES)[number],
    )
  ) {
    throw new ValidationError('Adjustments require a reason: CORRECTION, GOODWILL, or OTHER')
  }
  return { pointsDelta: delta, reasonCode: input.reasonCode, netPaidMinor: null }
}

async function replayResult(
  entry: LoyaltyLedgerEntryRow,
  account: LoyaltyAccountRow,
): Promise<LoyaltyPostingResult> {
  const quote = entry.kind === 'REDEEM' ? await quoteRedeem(Math.abs(entry.pointsDelta)) : null
  return { entry, account, lot: null, consumption: [], quote }
}

/**
 * Single write path for loyalty activity. Locks the account row, applies
 * kind-specific rules, consumes lots earliest-expiry-first, projects the
 * balance, audits the posting, and replays idempotently by
 * `(branchId, idempotencyKey)`.
 */
export async function postEntry(
  actor: AuditActor,
  input: LoyaltyPostEntryInput,
): Promise<LoyaltyPostingResult> {
  const normalized = normalizePosting(input)
  const occurredAt = input.occurredAt ?? new Date()

  if (input.idempotencyKey && input.branchId) {
    const existing = await findEntryByIdempotencyKey(input.branchId, input.idempotencyKey)
    if (existing) {
      const account = await findAccountByCustomerId(input.customerId)
      if (account) return replayResult(existing, account)
    }
  }

  try {
    return await db.transaction((tx) =>
      postEntryInTransaction(tx, actor, input, normalized, occurredAt),
    )
  } catch (error) {
    if (input.idempotencyKey && input.branchId && isUniqueViolation(error)) {
      const existing = await findEntryByIdempotencyKey(input.branchId, input.idempotencyKey)
      if (existing) {
        const account = await findAccountByCustomerId(input.customerId)
        if (account) return replayResult(existing, account)
      }
    }
    throw error
  }
}

/**
 * Transaction-scoped loyalty posting, called by the POS sale transaction so the
 * ledger, lots, sale rows, and audit commit atomically. `bypassBalanceCheck`
 * posts an offline redemption even when the minimum or the balance would reject
 * it; the projection may go negative and the caller raises the conflict.
 */
export async function postEntryInTransaction(
  tx: DbExecutor,
  actor: AuditActor,
  input: LoyaltyPostEntryInput,
  normalizedInput?: ReturnType<typeof normalizePosting>,
  occurredAtInput?: Date,
): Promise<LoyaltyPostingResult> {
  const normalized = normalizedInput ?? normalizePosting(input)
  const occurredAt = occurredAtInput ?? input.occurredAt ?? new Date()

  if (input.idempotencyKey && input.branchId) {
    const existing = await findEntryByIdempotencyKey(input.branchId, input.idempotencyKey, tx)
    if (existing) {
      const account = await findAccountByCustomerId(input.customerId, tx)
      if (account) return replayResult(existing, account)
    }
  }

  const customerRow = await requireCustomer(input.customerId, tx)
  if (customerRow.anonymizedAt) {
    throw new ConflictError('Anonymized customers cannot receive loyalty activity')
  }

  const account = await lockOrCreateAccount(tx, input.customerId)
  let pointsDelta = normalized.pointsDelta
  let quote: RedeemQuote | null = null

  if (input.kind === 'EARN') {
    const rate = await getSettingValue('loyalty.earnPointsPerCedi', {}, tx)
    const earned = Math.floor(((normalized.netPaidMinor ?? 0) * rate) / 100)
    if (earned < 1) {
      // Floor per sale, no carry: a sale below one point writes nothing.
      return { entry: null, account, lot: null, consumption: [], quote: null }
    }
    pointsDelta = earned
  }

  if (input.kind === 'REDEEM') {
    const requested = Math.abs(pointsDelta)
    if (!input.bypassBalanceCheck) {
      const minimumRedeem = await getSettingValue('loyalty.minimumRedeemPoints', {}, tx)
      if (requested < minimumRedeem) {
        throw new ConflictError(`A redemption requires at least ${minimumRedeem} points`)
      }
      if (account.balancePoints < requested) {
        throw new ConflictError('The customer does not have enough points for this redemption')
      }
    }
    quote = await quoteRedeem(requested, tx)
  }

  const entry = await insertEntry(
    {
      accountId: account.id,
      customerId: input.customerId,
      branchId: input.branchId,
      kind: input.kind,
      pointsDelta,
      reasonCode: normalized.reasonCode,
      note: input.note ?? null,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      referenceNumber: input.referenceNumber ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      createdBy: actorLabel(actor),
      occurredAt,
    },
    tx,
  )
  if (!entry) throw new AppError(500, 'INTERNAL', 'Failed to write the loyalty entry')

  let lot: LoyaltyLotRow | null = null
  const consumption: LoyaltyLotConsumptionRow[] = []

  if (pointsDelta > 0) {
    // Every positive posting creates a lot so expiry stays total (D14).
    const expiryMonths = await getSettingValue('loyalty.expiryMonths', {}, tx)
    lot = await insertLot(
      {
        accountId: account.id,
        earnEntryId: entry.id,
        points: pointsDelta,
        remainingPoints: pointsDelta,
        expiresAt: addMonths(occurredAt, expiryMonths),
      },
      tx,
    )
  } else {
    let outstanding = Math.abs(pointsDelta)
    const lots = await lockLotsFefo(tx, account.id)
    for (const lotRow of lots) {
      if (outstanding <= 0) break
      const take = Math.min(lotRow.remainingPoints, outstanding)
      if (take <= 0) continue
      const consumed = await appendConsumption(
        { lotId: lotRow.id, entryId: entry.id, points: take },
        tx,
      )
      if (consumed) consumption.push(consumed)
      await updateLotRemaining(lotRow.id, lotRow.remainingPoints - take, tx)
      outstanding -= take
    }
    if (input.kind === 'REDEEM' && outstanding > 0 && !input.bypassBalanceCheck) {
      // The balance guard guarantees full coverage; anything else is drift.
      throw new AppError(500, 'INTERNAL', 'Redemption exceeded the available lot points')
    }
  }

  const nextBalance = account.balancePoints + pointsDelta
  await updateAccountBalance(account.id, nextBalance, tx)

  await writeAudit(
    {
      ...actor,
      action: AUDIT_ACTIONS[input.kind],
      entity: 'loyalty_ledger_entry',
      entityId: entry.id,
      branchId: input.branchId,
      after: {
        kind: entry.kind,
        pointsDelta,
        reasonCode: normalized.reasonCode,
        netPaidMinor: normalized.netPaidMinor,
        referenceNumber: entry.referenceNumber,
        balancePoints: nextBalance,
        lotsConsumed: consumption.length,
        expiresAt: lot?.expiresAt ?? null,
      },
    },
    tx,
  )

  return { entry, account: { ...account, balancePoints: nextBalance }, lot, consumption, quote }
}

/**
 * Expires every live lot past `expiresAt`, one transaction per account: a
 * single EXPIRE entry (global — no branch, no creator) plus one consumption
 * row per lot. The jobs plan (05) schedules this daily; a second run with the
 * same `now` finds nothing and no-ops.
 */
export async function expireDueLots(now: Date = new Date()): Promise<ExpiryRunResult> {
  const accountIds = await listAccountIdsWithExpiredLots(now)
  let accounts = 0
  let lots = 0
  let points = 0

  for (const accountId of accountIds) {
    const expired = await db.transaction(async (tx) => {
      const account = await lockAccountById(tx, accountId)
      const dueLots = await lockExpiredLotsFefo(tx, accountId, now)
      const duePoints = dueLots.reduce((sum, lot) => sum + lot.remainingPoints, 0)
      if (dueLots.length === 0 || duePoints <= 0) return null

      const entry = await insertEntry(
        {
          accountId,
          customerId: account.customerId,
          branchId: null,
          kind: 'EXPIRE',
          pointsDelta: -duePoints,
          reasonCode: 'EXPIRY',
          note: null,
          idempotencyKey: null,
          createdBy: null,
          occurredAt: now,
        },
        tx,
      )
      if (!entry) throw new AppError(500, 'INTERNAL', 'Failed to write the expiry entry')

      for (const lot of dueLots) {
        await appendConsumption(
          { lotId: lot.id, entryId: entry.id, points: lot.remainingPoints },
          tx,
        )
        await updateLotRemaining(lot.id, 0, tx)
      }
      await updateAccountBalance(accountId, account.balancePoints - duePoints, tx)
      return { lots: dueLots.length, points: duePoints }
    })

    if (expired) {
      accounts += 1
      lots += expired.lots
      points += expired.points
    }
  }

  await writeAudit({
    action: 'loyalty.expiry_run',
    entity: 'loyalty_account',
    entityId: null,
    branchId: null,
    after: { accounts, lots, points, asOf: now.toISOString() },
  })

  return { accounts, lots, points }
}

function requirePostingBranch(user: SessionUser, requested: string | null | undefined): string {
  const branchId = resolveBranchFilter(user, requested ?? null)
  if (!branchId) throw new ValidationError('branchId is required to post a loyalty entry')
  return branchId
}

/** Staff postings from the console and the POS (Phase 6/7 reuse this path). */
export async function createEntry(
  actor: AuditActor,
  user: SessionUser,
  input: LoyaltyEntryCreateBody,
): Promise<LoyaltyPostingResult> {
  return postEntry(actor, {
    customerId: input.customerId,
    branchId: requirePostingBranch(user, input.branchId),
    kind: input.kind,
    netPaidMinor: input.netPaidMinor,
    pointsDelta: input.pointsDelta,
    reasonCode: input.reasonCode,
    note: input.note ?? null,
    occurredAt: input.occurredAt,
    referenceType: input.referenceType ?? null,
    referenceId: input.referenceId ?? null,
    referenceNumber: input.referenceNumber ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
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

const RECENT_ENTRY_LIMIT = 20

/**
 * Global read: loyalty is one balance per customer across branches; entries
 * carry their branch for display. Bootstraps the account if it is missing so
 * the 1:1 guarantee stays total.
 */
export async function getAccountDetail(customerId: string): Promise<LoyaltyAccountDetail> {
  await requireCustomer(customerId)
  await insertAccountForCustomer(customerId)
  const account = await findAccountByCustomerId(customerId)
  if (!account) throw new NotFoundError('Loyalty account not found')

  const [lots, entries, entryTotal] = await Promise.all([
    listLots(account.id),
    listEntries(account.id, { limit: RECENT_ENTRY_LIMIT }),
    countEntries(account.id),
  ])

  return {
    accountId: account.id,
    customerId,
    balancePoints: account.balancePoints,
    lots,
    entries,
    entryTotal,
  }
}

/** The liability headline looks 30 days ahead for near-expiry exposure. */
export const EXPIRING_SOON_DAYS = 30

/**
 * Redemption value of a points balance, in integer minor units.
 *
 * `pointsPerCedi` points redeem for one cedi, so one point is `100 / pointsPerCedi`
 * pesewas; the floor keeps the result integer. Exported because the analytics read model
 * must value the same points with the same rule rather than re-deriving it.
 */
export function pointsToValueMinor(points: number, pointsPerCedi: number): number {
  return Math.floor((points * 100) / pointsPerCedi)
}

/**
 * Liability report: outstanding points and their redemption value, points
 * expiring within 30 days, activity totals per branch for the range (managers
 * are scoped to their own branch plus global expiry rows; admins see every
 * branch), and negative balances (managers see the customers their branch
 * owns).
 */
export async function getLiability(
  user: SessionUser,
  query: LiabilityQuery,
): Promise<LoyaltyLiabilityReport> {
  const branchId = resolveBranchFilter(user, query.branchId ?? null)
  const from = query.from ?? null
  const to = query.to ? inclusiveEnd(query.to) : null
  const pointsPerCedi = await getSettingValue('loyalty.pointsPerCedi', {})
  const now = new Date()
  const expiringUntil = new Date(now.getTime() + EXPIRING_SOON_DAYS * 86_400_000)

  const [totals, expiringSoonPoints, activityRows, negativeBalances] = await Promise.all([
    sumOutstanding(),
    sumExpiringPoints(now, expiringUntil),
    getBranchActivityTotals({ from, to, branchId }),
    listNegativeBalances(branchId),
  ])

  return {
    asOf: now.toISOString(),
    pointsPerCedi,
    outstandingPoints: totals.points,
    outstandingValueMinor: pointsToValueMinor(totals.points, pointsPerCedi),
    expiringSoonPoints,
    activity: {
      from: from?.toISOString() ?? null,
      to: to?.toISOString() ?? null,
      branchId,
      rows: activityRows,
    },
    negativeBalances,
  }
}

/**
 * Loyalty liability as a file (RPT-05, P14-D17, P14-D21).
 *
 * The balance is **as of now** and says so: outstanding points are a live projection, and
 * an `asOf` would have to model which lots had expired by then. `from`/`to` filters the
 * *activity* section only, exactly as the JSON report does.
 *
 * Rows are the report's own headline and per-branch activity, never a collapsed `TOTAL`
 * row, so a manager hands their accountant their branch's movement.
 */
export async function exportLiability(
  user: SessionUser,
  query: LiabilityQuery,
): Promise<CsvExport> {
  const report = await getLiability(user, query)
  const branches = await listBranches(user, { includeInactive: true })
  const codeOf = (branchId: string | null): string => {
    if (!branchId) return 'all-branches'
    return branches.find((row) => row.id === branchId)?.code ?? ''
  }

  type Row = {
    section: string
    branchCode: string
    label: string
    points: number
    valueMinor: number | ''
  }

  const scopeCode = codeOf(report.activity.branchId)
  const rows: Row[] = [
    {
      section: 'liability',
      branchCode: scopeCode,
      label: 'outstanding_points',
      points: report.outstandingPoints,
      valueMinor: report.outstandingValueMinor,
    },
    {
      section: 'liability',
      branchCode: scopeCode,
      label: 'expiring_soon_points',
      points: report.expiringSoonPoints,
      valueMinor: pointsToValueMinor(report.expiringSoonPoints, report.pointsPerCedi),
    },
    {
      section: 'liability',
      branchCode: scopeCode,
      label: 'points_per_cedi',
      points: report.pointsPerCedi,
      valueMinor: '',
    },
  ]

  for (const activity of report.activity.rows) {
    const metrics: Array<[string, number]> = [
      ['earned_points', activity.earnedPoints],
      ['redeemed_points', activity.redeemedPoints],
      ['clawed_back_points', activity.clawedBackPoints],
      ['adjusted_points', activity.adjustedPoints],
      ['expired_points', activity.expiredPoints],
      ['net_points', activity.netPoints],
    ]
    for (const [label, points] of metrics) {
      rows.push({
        section: 'activity',
        branchCode: codeOf(activity.branchId),
        label,
        points,
        valueMinor: pointsToValueMinor(points, report.pointsPerCedi),
      })
    }
  }
  enforceExportCap(rows.length)

  rows.push({
    section: 'total',
    branchCode: scopeCode,
    label: 'TOTAL',
    points: report.outstandingPoints,
    valueMinor: report.outstandingValueMinor,
  })

  return {
    filename: csvFilename(
      'loyalty-liability',
      report.activity.branchId ? scopeCode : null,
      `asof-${accraIsoDay(report.asOf)}`,
    ),
    csv: toCsv(
      [
        { key: 'section', header: 'section' },
        { key: 'branchCode', header: 'branch_code' },
        { key: 'label', header: 'label' },
        { key: 'points', header: 'points' },
        { key: 'valueMinor', header: 'value_minor' },
      ],
      rows,
    ),
  }
}

/**
 * Read-only reconciliation across every account (no writes): the projected
 * balance must equal the ledger sum, and live lot remainders must equal the
 * positive ledger backing minus consumption. Used by tests and the Phase 8
 * reports.
 */
export async function reconcileAccounts(): Promise<LoyaltyReconciliationDivergence[]> {
  const [accounts, entrySums, lotSums, consumedSums] = await Promise.all([
    listAccountBalances(),
    sumEntriesByAccount(),
    sumLotRemainingByAccount(),
    sumConsumedByAccount(),
  ])

  const entriesByAccount = new Map(entrySums.map((row) => [row.accountId, row]))
  const lotsByAccount = new Map(lotSums.map((row) => [row.accountId, row.remainingPoints]))
  const consumedByAccount = new Map(consumedSums.map((row) => [row.accountId, row.points]))

  const divergences: LoyaltyReconciliationDivergence[] = []
  for (const account of accounts) {
    const entries = entriesByAccount.get(account.accountId)
    const expectedBalance = entries?.points ?? 0
    if (account.balancePoints !== expectedBalance) {
      divergences.push({
        accountId: account.accountId,
        customerId: account.customerId,
        kind: 'ledger',
        expected: expectedBalance,
        actual: account.balancePoints,
      })
    }

    const expectedRemaining =
      (entries?.positivePoints ?? 0) - (consumedByAccount.get(account.accountId) ?? 0)
    const actualRemaining = lotsByAccount.get(account.accountId) ?? 0
    if (actualRemaining !== expectedRemaining) {
      divergences.push({
        accountId: account.accountId,
        customerId: account.customerId,
        kind: 'lots',
        expected: expectedRemaining,
        actual: actualRemaining,
      })
    }
  }

  return divergences
}

/** One read-model helper pair so analytics never re-derives the programme's numbers. */

/**
 * Outstanding points across every account, i.e. the liability's point side. Exported for
 * the analytics read model (P9-D10): valuation stays in `pointsToValueMinor`, never in a
 * second module.
 */
export async function sumOutstandingPoints(
  executor: DbExecutor = db,
): Promise<{ accounts: number; points: number }> {
  return sumOutstanding(executor)
}

/** Remaining points in live lots expiring inside the standard 30-day window. */
export async function sumExpiringSoonPoints(now: Date, executor: DbExecutor = db): Promise<number> {
  const until = new Date(now.getTime() + EXPIRING_SOON_DAYS * 86_400_000)
  return sumExpiringPoints(now, until, executor)
}

export interface LoyaltyBranchActivityTotalsRow {
  branchId: string | null
  earnedPoints: number
  redeemedPoints: number
  clawedBackPoints: number
  adjustedPoints: number
  expiredPoints: number
  netPoints: number
}

/**
 * Per-branch activity for a range, including the single global expiry row (branch null).
 * The net formula lives here so the liability report and the analytics tab cannot drift.
 */
export async function getBranchActivityTotals(
  filter: { from: Date | null; to: Date | null; branchId: string | null },
  executor: DbExecutor = db,
): Promise<LoyaltyBranchActivityTotalsRow[]> {
  const activity = await branchActivity(filter, executor)
  return activity.map((row) => ({
    branchId: row.branchId,
    earnedPoints: row.earnedPoints,
    redeemedPoints: row.redeemedPoints,
    clawedBackPoints: row.clawedBackPoints,
    adjustedPoints: row.adjustedPoints,
    expiredPoints: row.expiredPoints,
    netPoints:
      row.earnedPoints -
      row.redeemedPoints -
      row.clawedBackPoints +
      row.adjustedPoints -
      row.expiredPoints,
  }))
}
