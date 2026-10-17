import { randomInt } from 'node:crypto'
import { db, type DbExecutor } from '@gikautos/db'
import { account, branch, user as userTable } from '@gikautos/db/schema'
import type { Role } from '@gikautos/shared'
import { and, asc, count, eq, or, type SQL, sql } from 'drizzle-orm'
import { auth } from '../../auth/auth.ts'
import { hashPassword, verifyPassword } from '../../auth/password.ts'
import { assertBranchAccess, branchScope, roleOf } from '../../auth/scope.ts'
import { revokeUserSessions } from '../../auth/sessions.ts'
import { env } from '../../config/env.ts'
import { email } from '../../email/index.ts'
import { AppError, ConflictError, ForbiddenError, NotFoundError } from '../../http/errors.ts'
import type { SessionData, SessionUser } from '../../http/factory.ts'
import { logger } from '../../logger.ts'
import { type AuditActor, writeAudit } from '../platform/audit.service.ts'
import { isUniqueViolation } from '../platform/db-errors.ts'
import { allocateStaffId } from '../platform/settings.service.ts'

const PASSWORD_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
const TEMPORARY_PASSWORD_LENGTH = 16

export function generateTemporaryPassword(): string {
  let password = ''
  for (let index = 0; index < TEMPORARY_PASSWORD_LENGTH; index += 1) {
    password += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)]
  }
  return password
}

const staffColumns = {
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

export interface CreateStaffInput {
  email: string
  name: string
  role: Role
  branchId?: string | null | undefined
  phone?: string | undefined
}

async function assertBranchUsable(branchId: string): Promise<void> {
  const rows = await db.select().from(branch).where(eq(branch.id, branchId)).limit(1)
  const found = rows[0]
  if (!found) throw new NotFoundError('Branch not found')
  if (!found.isActive) throw new ConflictError('Cannot assign staff to a deactivated branch')
}

function assertRoleBranchCombination(role: Role, branchId: string | null): void {
  if (role === 'ADMIN' && branchId) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Admins are not assigned to a branch')
  }
  if (role !== 'ADMIN' && !branchId) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'A branch is required for manager and cashier accounts',
    )
  }
}

async function assertNotLastAdmin(excludeUserId: string, executor: DbExecutor): Promise<void> {
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
  if ((rows[0]?.value ?? 0) === 0) {
    throw new ConflictError('The last active admin cannot be removed or demoted')
  }
}

export interface CreateStaffResult {
  staff: Record<string, unknown>
  temporaryPassword: string
  invitationSent: boolean
}

export async function createStaff(
  actorUser: SessionUser,
  actor: AuditActor,
  input: CreateStaffInput,
): Promise<CreateStaffResult> {
  const actorRole = roleOf(actorUser)
  const branchId = input.branchId ?? null

  if (actorRole !== 'ADMIN') {
    if (input.role === 'ADMIN') throw new ForbiddenError('Only admins can create admins')
    const scope = branchScope(actorUser)
    if (branchId !== scope) {
      throw new ForbiddenError('You can only create staff in your own branch')
    }
  }
  assertRoleBranchCombination(input.role, branchId)
  if (branchId) await assertBranchUsable(branchId)

  const emailAddress = input.email.trim().toLowerCase()
  const existing = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.email, emailAddress))
    .limit(1)
  if (existing[0]) throw new ConflictError('A user with this email already exists')

  const staffId = await allocateStaffId(db)
  const temporaryPassword = generateTemporaryPassword()

  let createdUserId: string
  try {
    const result = await auth.api.signUpEmail({
      body: { email: emailAddress, password: temporaryPassword, name: input.name.trim() },
    })
    createdUserId = result.user.id
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError('A user with this email already exists')
    throw error
  }

  try {
    const staff = await db.transaction(async (tx) => {
      const rows = await tx
        .update(userTable)
        .set({
          role: input.role,
          branchId,
          staffId,
          phone: input.phone ?? null,
          mustChangePassword: true,
        })
        .where(eq(userTable.id, createdUserId))
        .returning(staffColumns)
      const updated = rows[0]
      if (!updated) throw new ConflictError('A user with this email already exists')

      await writeAudit(
        {
          ...actor,
          action: 'staff.created',
          entity: 'user',
          entityId: updated.id,
          after: {
            staffId: updated.staffId,
            role: updated.role,
            branchId: updated.branchId,
            email: updated.email,
          },
          branchId: updated.branchId,
        },
        tx,
      )
      return updated
    })

    const invitationSent = await sendInvitation({
      to: emailAddress,
      name: input.name.trim(),
      temporaryPassword,
    })

    return { staff, temporaryPassword, invitationSent }
  } catch (error) {
    await db
      .delete(userTable)
      .where(eq(userTable.id, createdUserId))
      .catch((cleanupError) => {
        logger.error({ err: cleanupError, userId: createdUserId }, 'failed to clean up staff user')
      })
    throw error
  }
}

async function sendInvitation(data: {
  to: string
  name: string
  temporaryPassword: string
}): Promise<boolean> {
  const loginUrl = `${env.ADMIN_URL}/login`
  try {
    await email.send({
      to: data.to,
      subject: 'Your GikAutos account',
      text: `Hello ${data.name},\n\nAn account has been created for you on GikAutos.\n\nSign in at ${loginUrl}\nEmail: ${data.to}\nTemporary password: ${data.temporaryPassword}\n\nYou will be asked to choose a new password after signing in.`,
    })
    return true
  } catch (error) {
    logger.error({ err: error }, 'failed to send staff invitation email')
    return false
  }
}

export interface ListStaffFilters {
  role?: Role | undefined
  branchId?: string | undefined
  includeInactive: boolean
  search?: string | undefined
  limit: number
  offset: number
}

export async function listStaff(
  actorUser: SessionUser,
  filters: ListStaffFilters,
): Promise<{ staff: Record<string, unknown>[]; total: number }> {
  const scope = branchScope(actorUser)
  const conditions: SQL[] = []
  if (scope) conditions.push(eq(userTable.branchId, scope))
  else if (filters.branchId) conditions.push(eq(userTable.branchId, filters.branchId))
  if (filters.role) conditions.push(eq(userTable.role, filters.role))
  if (!filters.includeInactive) conditions.push(eq(userTable.isActive, true))
  if (filters.search) {
    const pattern = `%${filters.search.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`
    const searchCondition = or(
      sql`${userTable.name} ilike ${pattern}`,
      sql`${userTable.email} ilike ${pattern}`,
      sql`${userTable.staffId} ilike ${pattern}`,
    )
    if (searchCondition) conditions.push(searchCondition)
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined

  const rows = await db
    .select(staffColumns)
    .from(userTable)
    .where(where)
    .orderBy(asc(userTable.staffId), asc(userTable.createdAt))
    .limit(filters.limit)
    .offset(filters.offset)

  const totalRows = await db.select({ value: count() }).from(userTable).where(where)

  return { staff: rows, total: totalRows[0]?.value ?? 0 }
}

export async function getStaff(
  actorUser: SessionUser,
  id: string,
): Promise<Record<string, unknown>> {
  const rows = await db.select(staffColumns).from(userTable).where(eq(userTable.id, id)).limit(1)
  const found = rows[0]
  if (!found) throw new NotFoundError('Staff member not found')
  const scope = branchScope(actorUser)
  if (scope && found.branchId !== scope) {
    throw new ForbiddenError('You can only access your own branch')
  }
  return found
}

export interface UpdateStaffInput {
  name?: string | undefined
  phone?: string | undefined
  role?: Role | undefined
  branchId?: string | null | undefined
}

export async function updateStaff(
  actorUser: SessionUser,
  actor: AuditActor,
  id: string,
  input: UpdateStaffInput,
): Promise<Record<string, unknown>> {
  const actorRole = roleOf(actorUser)

  return db.transaction(async (tx) => {
    const rows = await tx.select().from(userTable).where(eq(userTable.id, id)).limit(1)
    const target = rows[0]
    if (!target) throw new NotFoundError('Staff member not found')

    if (actorRole !== 'ADMIN') {
      assertBranchAccess(actorUser, target.branchId ?? '')
      if (input.role !== undefined || input.branchId !== undefined) {
        throw new ForbiddenError('Only admins can change roles or branches')
      }
    }

    const nextRole = (input.role ?? target.role) as Role
    const nextBranchId = input.branchId !== undefined ? input.branchId : target.branchId
    assertRoleBranchCombination(nextRole, nextBranchId)
    if (nextBranchId && nextBranchId !== target.branchId) await assertBranchUsable(nextBranchId)

    if (target.role === 'ADMIN' && nextRole !== 'ADMIN') {
      await assertNotLastAdmin(target.id, tx)
    }

    const updatedRows = await tx
      .update(userTable)
      .set({
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.role !== undefined ? { role: input.role } : {}),
        ...(input.branchId !== undefined ? { branchId: input.branchId } : {}),
      })
      .where(eq(userTable.id, id))
      .returning(staffColumns)
    const updated = updatedRows[0]
    if (!updated) throw new AppError(500, 'INTERNAL', 'Failed to update staff member')

    await writeAudit(
      {
        ...actor,
        action: 'staff.updated',
        entity: 'user',
        entityId: id,
        before: {
          name: target.name,
          phone: target.phone,
          role: target.role,
          branchId: target.branchId,
        },
        after: {
          name: updated.name,
          phone: updated.phone,
          role: updated.role,
          branchId: updated.branchId,
        },
        branchId: updated.branchId,
      },
      tx,
    )
    return updated
  })
}

export async function setStaffActive(
  actorUser: SessionUser,
  actor: AuditActor,
  id: string,
  isActive: boolean,
): Promise<Record<string, unknown>> {
  const actorRole = roleOf(actorUser)

  return db.transaction(async (tx) => {
    const rows = await tx.select().from(userTable).where(eq(userTable.id, id)).limit(1)
    const target = rows[0]
    if (!target) throw new NotFoundError('Staff member not found')

    if (actorRole !== 'ADMIN') {
      assertBranchAccess(actorUser, target.branchId ?? '')
      if (target.role !== 'CASHIER') {
        throw new ForbiddenError('Managers can only deactivate cashiers')
      }
    }

    if (!isActive && target.id === actorUser.id) {
      throw new ConflictError('You cannot deactivate your own account')
    }

    if (!isActive && target.role === 'ADMIN') {
      await assertNotLastAdmin(target.id, tx)
    }

    if (target.isActive === isActive) return target

    const updatedRows = await tx
      .update(userTable)
      .set({ isActive })
      .where(eq(userTable.id, id))
      .returning(staffColumns)
    const updated = updatedRows[0]
    if (!updated) throw new AppError(500, 'INTERNAL', 'Failed to update staff member')

    if (!isActive) {
      await revokeUserSessions(target.id, {}, tx)
    }

    await writeAudit(
      {
        ...actor,
        action: isActive ? 'staff.reactivated' : 'staff.deactivated',
        entity: 'user',
        entityId: id,
        before: { isActive: target.isActive },
        after: { isActive: updated.isActive },
        branchId: updated.branchId,
      },
      tx,
    )
    return updated
  })
}

export interface ResetPasswordResult {
  temporaryPassword: string
  invitationSent: boolean
}

export async function resetStaffPassword(
  actorUser: SessionUser,
  actor: AuditActor,
  id: string,
): Promise<ResetPasswordResult> {
  const actorRole = roleOf(actorUser)
  const temporaryPassword = generateTemporaryPassword()
  const passwordHash = await hashPassword(temporaryPassword)

  const target = await db.transaction(async (tx) => {
    const rows = await tx.select().from(userTable).where(eq(userTable.id, id)).limit(1)
    const found = rows[0]
    if (!found) throw new NotFoundError('Staff member not found')

    if (actorRole !== 'ADMIN') {
      assertBranchAccess(actorUser, found.branchId ?? '')
      if (found.role !== 'CASHIER') {
        throw new ForbiddenError('Managers can only reset cashier passwords')
      }
    }

    await tx
      .update(account)
      .set({ password: passwordHash })
      .where(and(eq(account.userId, id), eq(account.providerId, 'credential')))

    await tx.update(userTable).set({ mustChangePassword: true }).where(eq(userTable.id, id))

    await revokeUserSessions(id, {}, tx)

    await writeAudit(
      {
        ...actor,
        action: 'staff.password.reset',
        entity: 'user',
        entityId: id,
        branchId: found.branchId,
      },
      tx,
    )

    return found
  })

  const invitationSent = await sendInvitation({
    to: target.email,
    name: target.name,
    temporaryPassword,
  })

  return { temporaryPassword, invitationSent }
}

export interface ChangeOwnPasswordInput {
  currentPassword: string
  newPassword: string
}

export async function changeOwnPassword(
  user: SessionUser,
  session: SessionData,
  actor: AuditActor,
  input: ChangeOwnPasswordInput,
): Promise<void> {
  const rows = await db
    .select({ password: account.password })
    .from(account)
    .where(and(eq(account.userId, user.id), eq(account.providerId, 'credential')))
    .limit(1)
  const stored = rows[0]?.password
  if (!stored) {
    throw new AppError(400, 'PASSWORD_NOT_SET', 'No password is set for this account')
  }

  const valid = await verifyPassword({ hash: stored, password: input.currentPassword })
  if (!valid) {
    throw new AppError(400, 'INVALID_PASSWORD', 'The current password is incorrect')
  }
  if (input.newPassword === input.currentPassword) {
    throw new AppError(400, 'VALIDATION_ERROR', 'The new password must be different')
  }

  const newHash = await hashPassword(input.newPassword)

  await db.transaction(async (tx) => {
    await tx
      .update(account)
      .set({ password: newHash })
      .where(and(eq(account.userId, user.id), eq(account.providerId, 'credential')))
    await tx.update(userTable).set({ mustChangePassword: false }).where(eq(userTable.id, user.id))
    await revokeUserSessions(user.id, { exceptToken: session.token }, tx)
    await writeAudit(
      {
        ...actor,
        action: 'auth.password.changed',
        entity: 'user',
        entityId: user.id,
        branchId: user.branchId,
      },
      tx,
    )
  })
}
