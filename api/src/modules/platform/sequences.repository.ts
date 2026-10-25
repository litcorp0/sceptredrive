import type { DbExecutor } from '@sceptre/db'
import { and, eq, sql } from 'drizzle-orm'
import { branch } from '../org/branches.schema.ts'
import { documentSequence } from './sequences.schema.ts'

/**
 * Data access for `document_sequence`. No business rules live here.
 */

/**
 * Atomically increments the counter and returns the serial just issued.
 *
 * `UPDATE … RETURNING` takes the row lock for the statement itself, so this is
 * safe in an autocommit call as well as inside a transaction. A read-then-write
 * with `FOR UPDATE` would only be safe inside a transaction, and the allocator
 * is used from both.
 */
export async function incrementSequenceRow(
  branchId: string,
  kind: string,
  period: string,
  executor: DbExecutor,
): Promise<{ value: number } | null> {
  const rows = await executor
    .update(documentSequence)
    .set({ value: sql`${documentSequence.value} + 1`, updatedAt: sql`now()` })
    .where(
      and(
        eq(documentSequence.branchId, branchId),
        eq(documentSequence.kind, kind),
        eq(documentSequence.period, period),
      ),
    )
    .returning({ value: documentSequence.value })
  return rows[0] ?? null
}

export async function insertSequenceRow(
  branchId: string,
  kind: string,
  period: string,
  value: number,
  executor: DbExecutor,
): Promise<void> {
  await executor
    .insert(documentSequence)
    .values({ branchId, kind, period, value })
    .onConflictDoNothing()
}

export async function findBranchCode(branchId: string, executor: DbExecutor): Promise<string> {
  const rows = await executor
    .select({ code: branch.code })
    .from(branch)
    .where(eq(branch.id, branchId))
  const row = rows[0]
  if (!row) throw new Error(`Branch ${branchId} does not exist`)
  return row.code
}
