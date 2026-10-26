import { type DbExecutor, db } from '@sceptre/db'
import { and, asc, count, desc, eq, gte, lt, lte, type SQL, sql } from 'drizzle-orm'
import { customer } from '../customers/customers.schema.ts'
import { branch } from '../org/branches.schema.ts'
import { creditLedgerEntry, creditProfile } from './credit.schema.ts'
import type {
  CreditEntryKind,
  CreditEntryListRow,
  CreditLedgerEntryRow,
  CreditProfileListRow,
  CreditProfileRow,
  OverLimitRow,
} from './credit.types.ts'

/**
 * Phase 3 D16 pattern: insert-or-ignore, then lock the row `FOR UPDATE`.
 * Every credit write path locks the profile first, so balance updates
 * serialize per customer+branch without deadlocks.
 */
export async function lockOrCreateProfile(
  executor: DbExecutor,
  customerId: string,
  branchId: string,
): Promise<CreditProfileRow> {
  await executor
    .insert(creditProfile)
    .values({ customerId, branchId })
    .onConflictDoNothing({ target: [creditProfile.customerId, creditProfile.branchId] })

  const rows = await executor
    .select()
    .from(creditProfile)
    .where(and(eq(creditProfile.customerId, customerId), eq(creditProfile.branchId, branchId)))
    .limit(1)
    .for('update')

  const row = rows[0]
  if (!row) throw new Error('Failed to lock the credit profile')
  return row
}

export async function findProfile(
  customerId: string,
  branchId: string,
  executor: DbExecutor = db,
): Promise<CreditProfileRow | null> {
  const rows = await executor
    .select()
    .from(creditProfile)
    .where(and(eq(creditProfile.customerId, customerId), eq(creditProfile.branchId, branchId)))
    .limit(1)
  return rows[0] ?? null
}

/** One profile by id — the approval subject is addressed by profile id (P12-D22). */
export async function findProfileById(
  id: string,
  executor: DbExecutor = db,
): Promise<CreditProfileRow | null> {
  const rows = await executor.select().from(creditProfile).where(eq(creditProfile.id, id)).limit(1)
  return rows[0] ?? null
}

/**
 * Locks one profile by id for the decision handler. The row lock is what makes
 * the stale-request check (`limit_minor` still equals the value the request was
 * valued against) race-free: a concurrent direct change waits, then this handler
 * sees it and refuses with a 409 (P12-D22).
 */
export async function lockProfileById(
  id: string,
  executor: DbExecutor,
): Promise<CreditProfileRow | null> {
  const rows = await executor
    .select()
    .from(creditProfile)
    .where(eq(creditProfile.id, id))
    .limit(1)
    .for('update')
  return rows[0] ?? null
}

/** The limit is an entitlement, not money owed: no ledger entry accompanies it. */
export async function updateProfileLimit(
  id: string,
  limitMinor: number,
  executor: DbExecutor = db,
): Promise<CreditProfileRow | null> {
  const rows = await executor
    .update(creditProfile)
    .set({ limitMinor })
    .where(eq(creditProfile.id, id))
    .returning()
  return rows[0] ?? null
}

export async function updateProfileBalance(
  id: string,
  balanceMinor: number,
  executor: DbExecutor = db,
): Promise<void> {
  await executor.update(creditProfile).set({ balanceMinor }).where(eq(creditProfile.id, id))
}

export async function updateProfileSettings(
  id: string,
  patch: Partial<typeof creditProfile.$inferInsert>,
  executor: DbExecutor = db,
): Promise<CreditProfileRow | null> {
  const rows = await executor
    .update(creditProfile)
    .set(patch)
    .where(eq(creditProfile.id, id))
    .returning()
  return rows[0] ?? null
}

export async function insertEntry(
  values: typeof creditLedgerEntry.$inferInsert,
  executor: DbExecutor = db,
): Promise<CreditLedgerEntryRow | null> {
  const rows = await executor.insert(creditLedgerEntry).values(values).returning()
  return rows[0] ?? null
}

export async function findEntryByIdempotencyKey(
  branchId: string,
  idempotencyKey: string,
  executor: DbExecutor = db,
): Promise<CreditLedgerEntryRow | null> {
  const rows = await executor
    .select()
    .from(creditLedgerEntry)
    .where(
      and(
        eq(creditLedgerEntry.branchId, branchId),
        eq(creditLedgerEntry.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1)
  return rows[0] ?? null
}

export interface EntryFilters {
  customerId?: string
  branchId?: string | null
  kind?: CreditEntryKind
  from?: Date
  to?: Date
}

function buildEntryCondition(filters: EntryFilters): SQL | undefined {
  const conditions: SQL[] = []
  if (filters.customerId) conditions.push(eq(creditLedgerEntry.customerId, filters.customerId))
  if (filters.branchId) conditions.push(eq(creditLedgerEntry.branchId, filters.branchId))
  if (filters.kind) conditions.push(eq(creditLedgerEntry.kind, filters.kind))
  if (filters.from) conditions.push(gte(creditLedgerEntry.occurredAt, filters.from))
  if (filters.to) conditions.push(lte(creditLedgerEntry.occurredAt, filters.to))
  return conditions.length > 0 ? and(...conditions) : undefined
}

const entryOrderAsc = [
  asc(creditLedgerEntry.occurredAt),
  asc(creditLedgerEntry.createdAt),
  asc(creditLedgerEntry.id),
]

const entryOrderDesc = [
  desc(creditLedgerEntry.occurredAt),
  desc(creditLedgerEntry.createdAt),
  desc(creditLedgerEntry.id),
]

/** Paginated ledger read for the console; newest first by default. */
export async function listEntryRows(
  filters: EntryFilters & { limit: number; offset: number; newestFirst?: boolean },
): Promise<CreditEntryListRow[]> {
  return db
    .select({
      id: creditLedgerEntry.id,
      customerId: creditLedgerEntry.customerId,
      branchId: creditLedgerEntry.branchId,
      kind: creditLedgerEntry.kind,
      amountMinor: creditLedgerEntry.amountMinor,
      reasonCode: creditLedgerEntry.reasonCode,
      method: creditLedgerEntry.method,
      note: creditLedgerEntry.note,
      dueDate: creditLedgerEntry.dueDate,
      referenceType: creditLedgerEntry.referenceType,
      referenceId: creditLedgerEntry.referenceId,
      referenceNumber: creditLedgerEntry.referenceNumber,
      overrideReason: creditLedgerEntry.overrideReason,
      overriddenBy: creditLedgerEntry.overriddenBy,
      receivedBy: creditLedgerEntry.receivedBy,
      idempotencyKey: creditLedgerEntry.idempotencyKey,
      createdBy: creditLedgerEntry.createdBy,
      occurredAt: creditLedgerEntry.occurredAt,
      createdAt: creditLedgerEntry.createdAt,
      branchCode: branch.code,
    })
    .from(creditLedgerEntry)
    .innerJoin(branch, eq(branch.id, creditLedgerEntry.branchId))
    .where(buildEntryCondition(filters))
    .orderBy(...(filters.newestFirst ? entryOrderDesc : entryOrderAsc))
    .limit(filters.limit)
    .offset(filters.offset)
}

export async function countEntryRows(filters: EntryFilters): Promise<number> {
  const rows = await db
    .select({ total: count() })
    .from(creditLedgerEntry)
    .where(buildEntryCondition(filters))
  return rows[0]?.total ?? 0
}

/** Full entry history for settlement (no pagination), oldest first. */
export async function listSettlementEntries(
  customerId: string,
  branchId: string,
): Promise<CreditLedgerEntryRow[]> {
  return db
    .select()
    .from(creditLedgerEntry)
    .where(
      and(eq(creditLedgerEntry.customerId, customerId), eq(creditLedgerEntry.branchId, branchId)),
    )
    .orderBy(...entryOrderAsc)
}

/** Full entry history for every customer at a branch (aging), oldest first. */
export async function listSettlementEntriesByBranch(
  branchId: string,
): Promise<CreditLedgerEntryRow[]> {
  return db
    .select()
    .from(creditLedgerEntry)
    .where(eq(creditLedgerEntry.branchId, branchId))
    .orderBy(...entryOrderAsc)
}

/** Signed sum of a customer+branch slice of the ledger. */
export async function sumForCustomerBranch(
  customerId: string,
  branchId: string,
  options: { from?: Date; to?: Date } = {},
): Promise<number> {
  const conditions: SQL[] = [
    eq(creditLedgerEntry.customerId, customerId),
    eq(creditLedgerEntry.branchId, branchId),
  ]
  if (options.from) conditions.push(gte(creditLedgerEntry.occurredAt, options.from))
  if (options.to) conditions.push(lte(creditLedgerEntry.occurredAt, options.to))

  const rows = await db
    .select({
      total: sql<number>`coalesce(sum(${creditLedgerEntry.amountMinor}), 0)`.mapWith(Number),
    })
    .from(creditLedgerEntry)
    .where(and(...conditions))
  return rows[0]?.total ?? 0
}

/** Ledger rows strictly before a boundary — the statement opening balance. */
export async function sumEntriesBefore(
  customerId: string,
  branchId: string,
  before: Date,
): Promise<number> {
  const rows = await db
    .select({
      total: sql<number>`coalesce(sum(${creditLedgerEntry.amountMinor}), 0)`.mapWith(Number),
    })
    .from(creditLedgerEntry)
    .where(
      and(
        eq(creditLedgerEntry.customerId, customerId),
        eq(creditLedgerEntry.branchId, branchId),
        lt(creditLedgerEntry.occurredAt, before),
      ),
    )
  return rows[0]?.total ?? 0
}

const profileListSelection = {
  id: creditProfile.id,
  customerId: creditProfile.customerId,
  customerName: customer.name,
  customerPhone: customer.phone,
  branchId: creditProfile.branchId,
  branchCode: branch.code,
  branchName: branch.name,
  limitMinor: creditProfile.limitMinor,
  hold: creditProfile.hold,
  paymentTermDays: creditProfile.paymentTermDays,
  notes: creditProfile.notes,
  balanceMinor: creditProfile.balanceMinor,
  createdAt: creditProfile.createdAt,
  updatedAt: creditProfile.updatedAt,
}

export async function listProfilesByCustomer(
  customerId: string,
  branchId: string | null = null,
): Promise<CreditProfileListRow[]> {
  const conditions: SQL[] = [eq(creditProfile.customerId, customerId)]
  if (branchId) conditions.push(eq(creditProfile.branchId, branchId))

  return db
    .select(profileListSelection)
    .from(creditProfile)
    .innerJoin(customer, eq(customer.id, creditProfile.customerId))
    .innerJoin(branch, eq(branch.id, creditProfile.branchId))
    .where(and(...conditions))
    .orderBy(asc(branch.code))
}

/** Every profile at a branch, joined with customer identity (aging). */
export async function listProfilesByBranch(branchId: string): Promise<CreditProfileListRow[]> {
  return db
    .select(profileListSelection)
    .from(creditProfile)
    .innerJoin(customer, eq(customer.id, creditProfile.customerId))
    .innerJoin(branch, eq(branch.id, creditProfile.branchId))
    .where(eq(creditProfile.branchId, branchId))
    .orderBy(asc(customer.name), asc(creditProfile.id))
}

export async function listBranchIdsWithProfiles(): Promise<
  { id: string; code: string; name: string }[]
> {
  return db
    .selectDistinct({ id: branch.id, code: branch.code, name: branch.name })
    .from(creditProfile)
    .innerJoin(branch, eq(branch.id, creditProfile.branchId))
    .orderBy(asc(branch.code))
}

/**
 * The one over-limit predicate, character for character the one analytics counts
 * (`analytics.repository.ts` `selectAttention`): `limit_minor > 0 AND
 * balance_minor > limit_minor`. A profile at exactly the limit is inside it, and a
 * zero limit is excluded so a brand-new profile with no entitlement is not
 * reported as over its limit (P12-D23).
 *
 * Kept as SQL text rather than column helpers so the two definitions read the same
 * and the parity test has something to hold on to.
 */
const OVER_LIMIT_PREDICATE = sql`${creditProfile.limitMinor} > 0 and ${creditProfile.balanceMinor} > ${creditProfile.limitMinor}`

function overLimitCondition(branchId: string | null): SQL {
  return branchId
    ? (and(OVER_LIMIT_PREDICATE, eq(creditProfile.branchId, branchId)) ?? OVER_LIMIT_PREDICATE)
    : OVER_LIMIT_PREDICATE
}

const overByMinor =
  sql<number>`${creditProfile.balanceMinor} - ${creditProfile.limitMinor}`.mapWith(Number)

/**
 * Rows for the manager's view, biggest exposure first — the customer most likely
 * to cost the branch money is at the top, and the order is stable across pages
 * because `id` breaks the tie.
 */
export async function listOverLimitProfiles(filters: {
  branchId: string | null
  limit: number
  offset: number
}): Promise<OverLimitRow[]> {
  return db
    .select({
      customerId: creditProfile.customerId,
      customerName: customer.name,
      phone: customer.phone,
      branchId: creditProfile.branchId,
      limitMinor: creditProfile.limitMinor,
      balanceMinor: creditProfile.balanceMinor,
      overByMinor,
    })
    .from(creditProfile)
    .innerJoin(customer, eq(customer.id, creditProfile.customerId))
    .where(overLimitCondition(filters.branchId))
    .orderBy(desc(overByMinor), asc(customer.name), asc(creditProfile.id))
    .limit(filters.limit)
    .offset(filters.offset)
}

/** The same predicate as a count, so `total` and the page can never disagree. */
export async function countOverLimitProfiles(branchId: string | null): Promise<number> {
  const rows = await db
    .select({ total: count() })
    .from(creditProfile)
    .where(overLimitCondition(branchId))
  return Number(rows[0]?.total ?? 0)
}
