import { type DbExecutor, db } from '@gikautos/db'
import { and, asc, count, desc, eq, gt, gte, lt, lte, type SQL, sql } from 'drizzle-orm'
import { customer } from '../customers/customers.schema.ts'
import {
  loyaltyAccount,
  loyaltyLedgerEntry,
  loyaltyLot,
  loyaltyLotConsumption,
} from './loyalty.schema.ts'
import type {
  LoyaltyAccountBalanceRow,
  LoyaltyAccountConsumedRow,
  LoyaltyAccountLotsRow,
  LoyaltyAccountRow,
  LoyaltyAccountSumRow,
  LoyaltyBranchActivityTotals,
  LoyaltyEntryListOptions,
  LoyaltyLedgerEntryRow,
  LoyaltyLotConsumptionRow,
  LoyaltyLotRow,
  LoyaltyNegativeBalance,
  LoyaltyOutstandingTotals,
} from './loyalty.types.ts'

/** Bootstrap helper: guarantees the 1:1 account exists before it is locked. */
export async function insertAccountForCustomer(
  customerId: string,
  executor: DbExecutor = db,
): Promise<void> {
  await executor
    .insert(loyaltyAccount)
    .values({ customerId })
    .onConflictDoNothing({ target: loyaltyAccount.customerId })
}

/**
 * Phase 3 D16 pattern: insert-or-ignore, then lock the row `FOR UPDATE`.
 * Every loyalty write path locks the account first, so balance updates
 * serialize per customer without deadlocks.
 */
export async function lockOrCreateAccount(
  executor: DbExecutor,
  customerId: string,
): Promise<LoyaltyAccountRow> {
  await insertAccountForCustomer(customerId, executor)
  const rows = await executor
    .select()
    .from(loyaltyAccount)
    .where(eq(loyaltyAccount.customerId, customerId))
    .limit(1)
    .for('update')

  const row = rows[0]
  if (!row) throw new Error('Failed to lock the loyalty account')
  return row
}

export async function lockAccountById(
  executor: DbExecutor,
  accountId: string,
): Promise<LoyaltyAccountRow> {
  const rows = await executor
    .select()
    .from(loyaltyAccount)
    .where(eq(loyaltyAccount.id, accountId))
    .limit(1)
    .for('update')

  const row = rows[0]
  if (!row) throw new Error('Failed to lock the loyalty account')
  return row
}

export async function findAccountByCustomerId(
  customerId: string,
  executor: DbExecutor = db,
): Promise<LoyaltyAccountRow | null> {
  const rows = await executor
    .select()
    .from(loyaltyAccount)
    .where(eq(loyaltyAccount.customerId, customerId))
    .limit(1)
  return rows[0] ?? null
}

export async function findEntryByIdempotencyKey(
  branchId: string,
  idempotencyKey: string,
  executor: DbExecutor = db,
): Promise<LoyaltyLedgerEntryRow | null> {
  const rows = await executor
    .select()
    .from(loyaltyLedgerEntry)
    .where(
      and(
        eq(loyaltyLedgerEntry.branchId, branchId),
        eq(loyaltyLedgerEntry.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1)
  return rows[0] ?? null
}

export async function insertEntry(
  values: typeof loyaltyLedgerEntry.$inferInsert,
  executor: DbExecutor = db,
): Promise<LoyaltyLedgerEntryRow | null> {
  const rows = await executor.insert(loyaltyLedgerEntry).values(values).returning()
  return rows[0] ?? null
}

export async function insertLot(
  values: typeof loyaltyLot.$inferInsert,
  executor: DbExecutor = db,
): Promise<LoyaltyLotRow | null> {
  const rows = await executor.insert(loyaltyLot).values(values).returning()
  return rows[0] ?? null
}

export async function appendConsumption(
  values: typeof loyaltyLotConsumption.$inferInsert,
  executor: DbExecutor = db,
): Promise<LoyaltyLotConsumptionRow | null> {
  const rows = await executor.insert(loyaltyLotConsumption).values(values).returning()
  return rows[0] ?? null
}

/**
 * Live lots (remaining points > 0) locked `FOR UPDATE`, ordered by
 * `(expiresAt, earnEntryId)` — FEFO consumption and deadlock-safe ordering
 * (D23).
 */
export async function lockLotsFefo(
  executor: DbExecutor,
  accountId: string,
): Promise<LoyaltyLotRow[]> {
  return executor
    .select()
    .from(loyaltyLot)
    .where(and(eq(loyaltyLot.accountId, accountId), gt(loyaltyLot.remainingPoints, 0)))
    .orderBy(asc(loyaltyLot.expiresAt), asc(loyaltyLot.earnEntryId))
    .for('update')
}

export async function updateAccountBalance(
  accountId: string,
  balancePoints: number,
  executor: DbExecutor = db,
): Promise<void> {
  await executor
    .update(loyaltyAccount)
    .set({ balancePoints })
    .where(eq(loyaltyAccount.id, accountId))
}

export async function updateLotRemaining(
  lotId: string,
  remainingPoints: number,
  executor: DbExecutor = db,
): Promise<void> {
  await executor.update(loyaltyLot).set({ remainingPoints }).where(eq(loyaltyLot.id, lotId))
}

export async function listLots(
  accountId: string,
  executor: DbExecutor = db,
): Promise<LoyaltyLotRow[]> {
  return executor
    .select()
    .from(loyaltyLot)
    .where(eq(loyaltyLot.accountId, accountId))
    .orderBy(asc(loyaltyLot.expiresAt), asc(loyaltyLot.earnEntryId))
}

export async function listEntries(
  accountId: string,
  options: LoyaltyEntryListOptions = {},
  executor: DbExecutor = db,
): Promise<LoyaltyLedgerEntryRow[]> {
  const order =
    options.newestFirst === false
      ? [asc(loyaltyLedgerEntry.occurredAt), asc(loyaltyLedgerEntry.createdAt)]
      : [desc(loyaltyLedgerEntry.occurredAt), desc(loyaltyLedgerEntry.createdAt)]

  return executor
    .select()
    .from(loyaltyLedgerEntry)
    .where(eq(loyaltyLedgerEntry.accountId, accountId))
    .orderBy(...order)
    .limit(options.limit ?? 50)
    .offset(options.offset ?? 0)
}

export async function countEntries(accountId: string, executor: DbExecutor = db): Promise<number> {
  const rows = await executor
    .select({ total: count() })
    .from(loyaltyLedgerEntry)
    .where(eq(loyaltyLedgerEntry.accountId, accountId))
  return Number(rows[0]?.total ?? 0)
}

/** Signed ledger sum; always equals the projected balance (reconciliation). */
export async function sumEntriesForAccount(
  accountId: string,
  executor: DbExecutor = db,
): Promise<number> {
  const rows = await executor
    .select({
      total: sql<number>`coalesce(sum(${loyaltyLedgerEntry.pointsDelta}), 0)`.mapWith(Number),
    })
    .from(loyaltyLedgerEntry)
    .where(eq(loyaltyLedgerEntry.accountId, accountId))
  return rows[0]?.total ?? 0
}

/** Live lot remainder sum (reconciliation). */
export async function sumLotRemaining(
  accountId: string,
  executor: DbExecutor = db,
): Promise<number> {
  const rows = await executor
    .select({
      total: sql<number>`coalesce(sum(${loyaltyLot.remainingPoints}), 0)`.mapWith(Number),
    })
    .from(loyaltyLot)
    .where(eq(loyaltyLot.accountId, accountId))
  return rows[0]?.total ?? 0
}

/** Consumed points across every lot of the account (reconciliation). */
export async function sumConsumedPoints(
  accountId: string,
  executor: DbExecutor = db,
): Promise<number> {
  const rows = await executor
    .select({
      total: sql<number>`coalesce(sum(${loyaltyLotConsumption.points}), 0)`.mapWith(Number),
    })
    .from(loyaltyLotConsumption)
    .innerJoin(loyaltyLot, eq(loyaltyLotConsumption.lotId, loyaltyLot.id))
    .where(eq(loyaltyLot.accountId, accountId))
  return rows[0]?.total ?? 0
}

/** Accounts holding at least one live lot past `expiresAt`. */
export async function listAccountIdsWithExpiredLots(
  now: Date,
  executor: DbExecutor = db,
): Promise<string[]> {
  const rows = await executor
    .selectDistinct({ accountId: loyaltyLot.accountId })
    .from(loyaltyLot)
    .where(and(gt(loyaltyLot.remainingPoints, 0), lte(loyaltyLot.expiresAt, now)))
  return rows.map((row) => row.accountId)
}

export async function lockExpiredLotsFefo(
  executor: DbExecutor,
  accountId: string,
  now: Date,
): Promise<LoyaltyLotRow[]> {
  return executor
    .select()
    .from(loyaltyLot)
    .where(
      and(
        eq(loyaltyLot.accountId, accountId),
        gt(loyaltyLot.remainingPoints, 0),
        lte(loyaltyLot.expiresAt, now),
      ),
    )
    .orderBy(asc(loyaltyLot.expiresAt), asc(loyaltyLot.earnEntryId))
    .for('update')
}

/**
 * Per-branch activity totals for the range. Managers get their own branch plus
 * the global (branch-less) expiry rows; admins see every branch.
 */
export async function branchActivity(
  filter: { from: Date | null; to: Date | null; branchId: string | null },
  executor: DbExecutor = db,
): Promise<LoyaltyBranchActivityTotals[]> {
  const conditions: SQL[] = []
  if (filter.from) conditions.push(gte(loyaltyLedgerEntry.occurredAt, filter.from))
  if (filter.to) conditions.push(lte(loyaltyLedgerEntry.occurredAt, filter.to))
  if (filter.branchId) {
    conditions.push(
      sql`(${loyaltyLedgerEntry.branchId} = ${filter.branchId} or (${loyaltyLedgerEntry.branchId} is null and ${loyaltyLedgerEntry.kind} = 'EXPIRE'))`,
    )
  }

  const sumFor = (condition: SQL) =>
    sql<number>`coalesce(sum(case when ${condition} then ${loyaltyLedgerEntry.pointsDelta} else 0 end), 0)`.mapWith(
      Number,
    )

  return executor
    .select({
      branchId: loyaltyLedgerEntry.branchId,
      earnedPoints: sumFor(sql`${loyaltyLedgerEntry.kind} = 'EARN'`),
      redeemedPoints:
        sql<number>`coalesce(sum(case when ${loyaltyLedgerEntry.kind} = 'REDEEM' then -(${loyaltyLedgerEntry.pointsDelta}) else 0 end), 0)`.mapWith(
          Number,
        ),
      clawedBackPoints:
        sql<number>`coalesce(sum(case when ${loyaltyLedgerEntry.kind} = 'CLAWBACK' then -(${loyaltyLedgerEntry.pointsDelta}) else 0 end), 0)`.mapWith(
          Number,
        ),
      adjustedPoints: sumFor(sql`${loyaltyLedgerEntry.kind} = 'ADJUST'`),
      expiredPoints:
        sql<number>`coalesce(sum(case when ${loyaltyLedgerEntry.kind} = 'EXPIRE' then -(${loyaltyLedgerEntry.pointsDelta}) else 0 end), 0)`.mapWith(
          Number,
        ),
    })
    .from(loyaltyLedgerEntry)
    .where(and(...conditions))
    .groupBy(loyaltyLedgerEntry.branchId)
    .orderBy(asc(loyaltyLedgerEntry.branchId))
}

/** Outstanding points across every account (the loyalty liability). */
export async function sumOutstanding(executor: DbExecutor = db): Promise<LoyaltyOutstandingTotals> {
  const rows = await executor
    .select({
      accounts: count(),
      points: sql<number>`coalesce(sum(${loyaltyAccount.balancePoints}), 0)`.mapWith(Number),
    })
    .from(loyaltyAccount)
  return { accounts: Number(rows[0]?.accounts ?? 0), points: rows[0]?.points ?? 0 }
}

/** Accounts with a negative balance, optionally scoped to a customer branch. */
export async function listNegativeBalances(
  branchId: string | null,
  executor: DbExecutor = db,
): Promise<LoyaltyNegativeBalance[]> {
  const conditions: SQL[] = [lt(loyaltyAccount.balancePoints, 0)]
  if (branchId) conditions.push(eq(customer.createdBranchId, branchId))

  return executor
    .select({
      customerId: loyaltyAccount.customerId,
      customerName: customer.name,
      branchId: customer.createdBranchId,
      balancePoints: loyaltyAccount.balancePoints,
    })
    .from(loyaltyAccount)
    .innerJoin(customer, eq(loyaltyAccount.customerId, customer.id))
    .where(and(...conditions))
    .orderBy(asc(loyaltyAccount.balancePoints))
    .limit(200)
}

/** Projected balances for every account (reconciliation scan). */
export async function listAccountBalances(
  executor: DbExecutor = db,
): Promise<LoyaltyAccountBalanceRow[]> {
  return executor
    .select({
      accountId: loyaltyAccount.id,
      customerId: loyaltyAccount.customerId,
      balancePoints: loyaltyAccount.balancePoints,
    })
    .from(loyaltyAccount)
}

/** Signed and positive ledger sums per account (reconciliation scan). */
export async function sumEntriesByAccount(
  executor: DbExecutor = db,
): Promise<LoyaltyAccountSumRow[]> {
  return executor
    .select({
      accountId: loyaltyLedgerEntry.accountId,
      points: sql<number>`coalesce(sum(${loyaltyLedgerEntry.pointsDelta}), 0)`.mapWith(Number),
      positivePoints:
        sql<number>`coalesce(sum(case when ${loyaltyLedgerEntry.pointsDelta} > 0 then ${loyaltyLedgerEntry.pointsDelta} else 0 end), 0)`.mapWith(
          Number,
        ),
    })
    .from(loyaltyLedgerEntry)
    .groupBy(loyaltyLedgerEntry.accountId)
}

/** Live lot remainders per account (reconciliation scan). */
export async function sumLotRemainingByAccount(
  executor: DbExecutor = db,
): Promise<LoyaltyAccountLotsRow[]> {
  return executor
    .select({
      accountId: loyaltyLot.accountId,
      remainingPoints: sql<number>`coalesce(sum(${loyaltyLot.remainingPoints}), 0)`.mapWith(Number),
    })
    .from(loyaltyLot)
    .groupBy(loyaltyLot.accountId)
}

/** Consumed points per account (reconciliation scan). */
export async function sumConsumedByAccount(
  executor: DbExecutor = db,
): Promise<LoyaltyAccountConsumedRow[]> {
  return executor
    .select({
      accountId: loyaltyLot.accountId,
      points: sql<number>`coalesce(sum(${loyaltyLotConsumption.points}), 0)`.mapWith(Number),
    })
    .from(loyaltyLotConsumption)
    .innerJoin(loyaltyLot, eq(loyaltyLotConsumption.lotId, loyaltyLot.id))
    .groupBy(loyaltyLot.accountId)
}
