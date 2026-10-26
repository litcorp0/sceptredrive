import { type DbExecutor, db } from '@sceptre/db'
import { and, asc, eq, type SQL } from 'drizzle-orm'
import { branch } from './branches.schema.ts'
import type { BranchDirectoryEntry, BranchRow } from './branches.types.ts'

export async function listBranchRows(
  options: { branchId?: string | null | undefined; includeInactive: boolean },
  executor: DbExecutor = db,
): Promise<BranchRow[]> {
  const filters: SQL[] = []
  if (options.branchId) filters.push(eq(branch.id, options.branchId))
  if (!options.includeInactive) filters.push(eq(branch.isActive, true))

  return executor
    .select()
    .from(branch)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(asc(branch.code))
}

export async function findBranchById(
  id: string,
  executor: DbExecutor = db,
): Promise<BranchRow | null> {
  const rows = await executor.select().from(branch).where(eq(branch.id, id)).limit(1)
  return rows[0] ?? null
}

/**
 * Unscoped directory read: every active branch, projected to the picker fields.
 * Kept separate from `listBranchRows` so `/api/branches` stays branch-scoped.
 */
export async function listActiveBranchDirectoryRows(
  executor: DbExecutor = db,
): Promise<BranchDirectoryEntry[]> {
  return executor
    .select({
      id: branch.id,
      code: branch.code,
      name: branch.name,
      type: branch.type,
    })
    .from(branch)
    .where(eq(branch.isActive, true))
    .orderBy(asc(branch.code))
}

export async function insertBranch(
  values: typeof branch.$inferInsert,
  executor: DbExecutor = db,
): Promise<BranchRow | null> {
  const rows = await executor.insert(branch).values(values).returning()
  return rows[0] ?? null
}

export async function updateBranchRow(
  id: string,
  patch: Partial<typeof branch.$inferInsert>,
  executor: DbExecutor = db,
): Promise<BranchRow | null> {
  const rows = await executor.update(branch).set(patch).where(eq(branch.id, id)).returning()
  return rows[0] ?? null
}

export async function selectBranchCodes(executor: DbExecutor = db): Promise<string[]> {
  const rows = await executor.select({ code: branch.code }).from(branch)
  return rows.map((row) => row.code)
}
