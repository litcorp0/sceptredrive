import { type DbExecutor, db } from '@sceptre/db'
import type { Role } from '@sceptre/shared'
import { and, asc, count, eq, gt, isNull, or, type SQL, sql } from 'drizzle-orm'
import { posStaffBinding } from '../pos/pos.schema.ts'
import { account, user as userTable } from './staff.schema.ts'
import type { StaffPinState, StaffRow } from './staff.types.ts'

/**
 * Staff profile projection. Includes PIN *metadata* (version, must-change) so
 * the console can render a badge, but never the hash: that column is only read
 * by the PIN verification path.
 */
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
  pinVersion: userTable.pinVersion,
  pinMustChange: userTable.pinMustChange,
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

/**
 * Stores a manager-set temporary PIN and bumps its version in one statement, so
 * every terminal holding the previous version fails closed.
 */
export async function updateStaffPin(
  userId: string,
  pinHash: string,
  executor: DbExecutor = db,
): Promise<{ pinVersion: number } | null> {
  const rows = await executor
    .update(userTable)
    .set({
      pinHash,
      pinMustChange: true,
      pinVersion: sql`${userTable.pinVersion} + 1`,
    })
    .where(eq(userTable.id, userId))
    .returning({ pinVersion: userTable.pinVersion })
  return rows[0] ?? null
}

/** Invalidates every existing PIN binding without touching the hash. */
export async function bumpStaffPinVersion(
  userId: string,
  executor: DbExecutor = db,
): Promise<number | null> {
  const rows = await executor
    .update(userTable)
    .set({ pinVersion: sql`${userTable.pinVersion} + 1` })
    .where(eq(userTable.id, userId))
    .returning({ pinVersion: userTable.pinVersion })
  return rows[0]?.pinVersion ?? null
}

/** Revokes every live terminal binding for a staff member; returns how many. */
export async function revokeStaffBindings(
  staffUserId: string,
  revokedBy: string | null,
  executor: DbExecutor = db,
): Promise<number> {
  const rows = await executor
    .update(posStaffBinding)
    .set({ revokedAt: new Date(), revokedBy })
    .where(and(eq(posStaffBinding.staffUserId, staffUserId), isNull(posStaffBinding.revokedAt)))
    .returning({ id: posStaffBinding.id })
  return rows.length
}

export async function selectStaffPinState(
  userId: string,
  executor: DbExecutor = db,
): Promise<StaffPinState | null> {
  const rows = await executor
    .select({
      hasPin: sql<boolean>`${userTable.pinHash} is not null`,
      pinVersion: userTable.pinVersion,
      pinMustChange: userTable.pinMustChange,
    })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1)
  const row = rows[0]
  if (!row) return null

  const bindings = await executor
    .select({ value: count() })
    .from(posStaffBinding)
    .where(
      and(
        eq(posStaffBinding.staffUserId, userId),
        isNull(posStaffBinding.revokedAt),
        gt(posStaffBinding.expiresAt, new Date()),
      ),
    )

  return {
    hasPin: Boolean(row.hasPin),
    pinVersion: row.pinVersion,
    pinMustChange: row.pinMustChange,
    activeBindings: bindings[0]?.value ?? 0,
  }
}
