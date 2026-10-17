import { type DbExecutor, db } from '@gikautos/db'
import { account, user as userTable } from '@gikautos/db/schema'
import type { Role } from '@gikautos/shared'
import { and, asc, count, eq, or, type SQL, sql } from 'drizzle-orm'
import type { StaffRow } from './staff.types.ts'

/** Staff profile projection; never selects credential or PIN columns. */
export const staffColumns = {
  id: userTable.id,
  name: userTable.name,
  email: userTable.email,
  role: userTable.role,
  branchId: userTable.branchId,
  staffId: userTable.staffId,
  phone: userTable.phone,
  isActive: userTable.isActive,
  mustChangePassword: userTable.mustChangePassword,
  twoFactorEnabled: userTable.twoFactorEnabled,
  createdAt: userTable.createdAt,
  updatedAt: userTable.updatedAt,
}

export interface StaffQueryScope {
  branchId: string | null
  role?: Role | undefined
  includeInactive: boolean
  search?: string | undefined
}

function buildWhere(scope: StaffQueryScope): SQL | undefined {
  const conditions: SQL[] = []
  if (scope.branchId) conditions.push(eq(userTable.branchId, scope.branchId))
  if (scope.role) conditions.push(eq(userTable.role, scope.role))
  if (!scope.includeInactive) conditions.push(eq(userTable.isActive, true))
  if (scope.search) {
    const escaped = scope.search.replaceAll('%', '\\%').replaceAll('_', '\\_')
    const pattern = `%${escaped}%`
    const searchCondition = or(
      sql`${userTable.name} ilike ${pattern}`,
      sql`${userTable.email} ilike ${pattern}`,
      sql`${userTable.staffId} ilike ${pattern}`,
    )
    if (searchCondition) conditions.push(searchCondition)
  }
  return conditions.length > 0 ? and(...conditions) : undefined
}

export async function selectStaffPage(
  scope: StaffQueryScope,
  pagination: { limit: number; offset: number },
  executor: DbExecutor = db,
): Promise<StaffRow[]> {
  return executor
    .select(staffColumns)
    .from(userTable)
    .where(buildWhere(scope))
    .orderBy(asc(userTable.staffId), asc(userTable.createdAt))
    .limit(pagination.limit)
    .offset(pagination.offset)
}

export async function countStaffRows(
  scope: StaffQueryScope,
  executor: DbExecutor = db,
): Promise<number> {
  const rows = await executor.select({ value: count() }).from(userTable).where(buildWhere(scope))
  return rows[0]?.value ?? 0
}

export async function findStaffById(
  id: string,
  executor: DbExecutor = db,
): Promise<StaffRow | null> {
  const rows = await executor
    .select(staffColumns)
    .from(userTable)
    .where(eq(userTable.id, id))
    .limit(1)
  return rows[0] ?? null
}

export async function findUserById(
  id: string,
  executor: DbExecutor = db,
): Promise<typeof userTable.$inferSelect | null> {
  const rows = await executor.select().from(userTable).where(eq(userTable.id, id)).limit(1)
  return rows[0] ?? null
}

export async function findUserIdByEmail(
  email: string,
  executor: DbExecutor = db,
): Promise<{ id: string } | null> {
  const rows = await executor
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.email, email.toLowerCase()))
    .limit(1)
  return rows[0] ?? null
}

export async function updateUserRow(
  id: string,
  patch: Partial<typeof userTable.$inferInsert>,
  executor: DbExecutor = db,
): Promise<StaffRow | null> {
  const rows = await executor
    .update(userTable)
    .set(patch)
    .where(eq(userTable.id, id))
    .returning(staffColumns)
  return rows[0] ?? null
}

export async function countOtherActiveAdmins(
  excludeUserId: string,
  executor: DbExecutor = db,
): Promise<number> {
  const rows = await executor
    .select({ value: count() })
    .from(userTable)
    .where(
      and(
        eq(userTable.role, 'ADMIN'),
        eq(userTable.isActive, true),
        sql`${userTable.id} <> ${excludeUserId}`,
      ),
    )
  return rows[0]?.value ?? 0
}

export async function deleteUserRow(id: string, executor: DbExecutor = db): Promise<void> {
  await executor.delete(userTable).where(eq(userTable.id, id))
}

export async function findCredentialPassword(
  userId: string,
  executor: DbExecutor = db,
): Promise<string | null> {
  const rows = await executor
    .select({ password: account.password })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, 'credential')))
    .limit(1)
  return rows[0]?.password ?? null
}

export async function updateCredentialPassword(
  userId: string,
  passwordHash: string,
  executor: DbExecutor = db,
): Promise<void> {
  await executor
    .update(account)
    .set({ password: passwordHash })
    .where(and(eq(account.userId, userId), eq(account.providerId, 'credential')))
}
