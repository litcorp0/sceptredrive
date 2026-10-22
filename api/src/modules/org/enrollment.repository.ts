import { type DbExecutor, db } from '@gikautos/db'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { terminalEnrollment } from './enrollment.schema.ts'
import type { TerminalEnrollmentRow } from './enrollment.types.ts'

export async function expireOutstandingEnrollments(
  terminalId: string,
  executor: DbExecutor = db,
): Promise<void> {
  await executor
    .update(terminalEnrollment)
    .set({ expiresAt: new Date() })
    .where(
      and(
        eq(terminalEnrollment.terminalId, terminalId),
        isNull(terminalEnrollment.usedAt),
        sql`${terminalEnrollment.expiresAt} > now()`,
      ),
    )
}

export async function insertEnrollmentRow(
  values: typeof terminalEnrollment.$inferInsert,
  executor: DbExecutor = db,
): Promise<TerminalEnrollmentRow | null> {
  const rows = await executor.insert(terminalEnrollment).values(values).returning()
  return rows[0] ?? null
}

export async function findEnrollmentByCodeHash(
  codeHash: string,
  executor: DbExecutor = db,
): Promise<TerminalEnrollmentRow | null> {
  const rows = await executor
    .select()
    .from(terminalEnrollment)
    .where(eq(terminalEnrollment.codeHash, codeHash))
    .limit(1)
  return rows[0] ?? null
}

/**
 * Locks the enrollment row so two terminals racing on one code cannot both
 * redeem it: the second transaction waits, then sees `used_at` set.
 */
export async function findEnrollmentByCodeHashForUpdate(
  codeHash: string,
  executor: DbExecutor = db,
): Promise<TerminalEnrollmentRow | null> {
  const rows = await executor
    .select()
    .from(terminalEnrollment)
    .where(eq(terminalEnrollment.codeHash, codeHash))
    .limit(1)
    .for('update')
  return rows[0] ?? null
}

export async function markEnrollmentUsed(
  id: string,
  usedAt: Date,
  executor: DbExecutor = db,
): Promise<void> {
  await executor.update(terminalEnrollment).set({ usedAt }).where(eq(terminalEnrollment.id, id))
}
