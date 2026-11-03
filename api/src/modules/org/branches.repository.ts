import { type DbExecutor, db } from '@sceptre/db'
import { and, asc, eq, type SQL } from 'drizzle-orm'
import { branch } from './branches.schema.ts'
import type { BranchDirectoryEntry, BranchRow, PublicBranchContact } from './branches.types.ts'

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

/**
 * Active retail branches with the contact columns the public site may show.
 * Warehouses are stock-only (INV-09) and are never a customer location, so they
 * are filtered here rather than in the website.
 */
export async function listActiveRetailBranchContacts(
  executor: DbExecutor = db,
): Promise<PublicBranchContact[]> {
  return executor
    .select({
      id: branch.id,
      code: branch.code,
      name: branch.name,
      city: branch.city,
      area: branch.area,
      address: branch.address,
      phone: branch.phone,
      latitude: branch.latitude,
      longitude: branch.longitude,
    })
    .from(branch)
    .where(and(eq(branch.isActive, true), eq(branch.type, 'RETAIL')))
    .orderBy(asc(branch.name))
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
