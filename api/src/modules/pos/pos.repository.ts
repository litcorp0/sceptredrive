import { type DbExecutor, db } from '@gikautos/db'
import { isRole } from '@gikautos/shared'
import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import { user as userTable } from '../identity/staff.schema.ts'
import { posStaffBinding } from './pos.schema.ts'
import type { DeviceStaffRecord } from './pos.types.ts'

/** Signs in a staff member by staff code, email, or both (whichever was supplied). */
export async function findStaffForAuthorization(
  identity: { staffCode?: string | undefined; email?: string | undefined },
  executor: DbExecutor = db,
): Promise<DeviceStaffRecord | null> {
  const conditions = []
  if (identity.staffCode) conditions.push(eq(userTable.staffId, identity.staffCode))
  if (identity.email) conditions.push(eq(userTable.email, identity.email.toLowerCase()))
  if (conditions.length === 0) return null

  const rows = await executor
    .select({
      userId: userTable.id,
      staffId: userTable.staffId,
      name: userTable.name,
      role: userTable.role,
      branchId: userTable.branchId,
      isActive: userTable.isActive,
      pinHash: userTable.pinHash,
      pinVersion: userTable.pinVersion,
      pinMustChange: userTable.pinMustChange,
    })
    .from(userTable)
    .where(and(...conditions))
    .limit(1)

  const row = rows[0]
  if (!row || !row.staffId || !isRole(row.role)) return null
  return { ...row, staffId: row.staffId, role: row.role }
}

/** Resolves a binding from its hashed token, joined to the owning staff member. */
export async function findBindingByTokenHash(
  tokenHash: string,
  executor: DbExecutor = db,
): Promise<{
  binding: typeof posStaffBinding.$inferSelect
  staff: DeviceStaffRecord
} | null> {
  const rows = await executor
    .select({
      binding: posStaffBinding,
      userId: userTable.id,
      staffId: userTable.staffId,
      name: userTable.name,
      role: userTable.role,
      branchId: userTable.branchId,
      isActive: userTable.isActive,
      pinHash: userTable.pinHash,
      pinVersion: userTable.pinVersion,
      pinMustChange: userTable.pinMustChange,
    })
    .from(posStaffBinding)
    .innerJoin(userTable, eq(posStaffBinding.staffUserId, userTable.id))
    .where(eq(posStaffBinding.bindingTokenHash, tokenHash))
    .limit(1)

  const row = rows[0]
  if (!row || !row.staffId || !isRole(row.role)) return null

  return {
    binding: row.binding,
    staff: {
      userId: row.userId,
      staffId: row.staffId,
      name: row.name,
      role: row.role,
      branchId: row.branchId,
      isActive: row.isActive,
      pinHash: row.pinHash,
      pinVersion: row.pinVersion,
      pinMustChange: row.pinMustChange,
    },
  }
}

export async function findActiveBinding(
  deviceId: string,
  staffUserId: string,
  executor: DbExecutor = db,
): Promise<typeof posStaffBinding.$inferSelect | null> {
  const rows = await executor
    .select()
    .from(posStaffBinding)
    .where(
      and(
        eq(posStaffBinding.deviceId, deviceId),
        eq(posStaffBinding.staffUserId, staffUserId),
        isNull(posStaffBinding.revokedAt),
        gt(posStaffBinding.expiresAt, new Date()),
      ),
    )
    .limit(1)
  return rows[0] ?? null
}

export async function insertBinding(
  values: typeof posStaffBinding.$inferInsert,
  executor: DbExecutor = db,
): Promise<typeof posStaffBinding.$inferSelect> {
  const rows = await executor.insert(posStaffBinding).values(values).returning()
  const row = rows[0]
  if (!row) throw new Error('Failed to create the staff binding')
  return row
}

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

export async function revokeBinding(
  bindingId: string,
  revokedBy: string | null,
  executor: DbExecutor = db,
): Promise<void> {
  await executor
    .update(posStaffBinding)
    .set({ revokedAt: new Date(), revokedBy })
    .where(eq(posStaffBinding.id, bindingId))
}

export async function touchBinding(bindingId: string, executor: DbExecutor = db): Promise<void> {
  await executor
    .update(posStaffBinding)
    .set({ lastUsedAt: new Date() })
    .where(eq(posStaffBinding.id, bindingId))
}

export async function updateStaffPinHash(
  userId: string,
  pinHash: string,
  executor: DbExecutor = db,
): Promise<number | null> {
  const rows = await executor
    .update(userTable)
    .set({
      pinHash,
      pinVersion: sql`${userTable.pinVersion} + 1`,
      pinMustChange: false,
    })
    .where(eq(userTable.id, userId))
    .returning({ pinVersion: userTable.pinVersion })
  return rows[0]?.pinVersion ?? null
}

/** Finds a staff member by id for the change-PIN path. */
export async function findStaffById(
  userId: string,
  executor: DbExecutor = db,
): Promise<DeviceStaffRecord | null> {
  const rows = await executor
    .select({
      userId: userTable.id,
      staffId: userTable.staffId,
      name: userTable.name,
      role: userTable.role,
      branchId: userTable.branchId,
      isActive: userTable.isActive,
      pinHash: userTable.pinHash,
      pinVersion: userTable.pinVersion,
      pinMustChange: userTable.pinMustChange,
    })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1)

  const row = rows[0]
  if (!row || !row.staffId || !isRole(row.role)) return null
  return { ...row, staffId: row.staffId, role: row.role }
}
