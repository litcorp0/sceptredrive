import { type DbExecutor, db } from '@gikautos/db'
import { and, asc, count, desc, eq, gt, lte, sql } from 'drizzle-orm'
import {
  loyaltyAccount,
  loyaltyLedgerEntry,
  loyaltyLot,
  loyaltyLotConsumption,
} from './loyalty.schema.ts'
import type {
  LoyaltyAccountRow,
  LoyaltyEntryListOptions,
  LoyaltyLedgerEntryRow,
  LoyaltyLotConsumptionRow,
  LoyaltyLotRow,
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
