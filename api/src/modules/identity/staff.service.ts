import { randomInt } from 'node:crypto'
import { db } from '@sceptre/db'
import { pinProblem, type Role } from '@sceptre/shared'
import { auth } from '../../auth/auth.ts'
import { hashPassword, verifyPassword } from '../../auth/password.ts'
import { assertBranchAccess, branchScope, roleOf } from '../../auth/scope.ts'
import { revokeUserSessions } from '../../auth/sessions.ts'
import { env } from '../../config/env.ts'
import { email } from '../../email/index.ts'
import { AppError, ConflictError, ForbiddenError, NotFoundError } from '../../http/errors.ts'
import type { SessionData, SessionUser } from '../../http/factory.ts'
import { logger } from '../../logger.ts'
import * as branchesService from '../org/branches.service.ts'
import { writeAudit } from '../platform/audit.service.ts'
import type { AuditActor } from '../platform/audit.types.ts'
import { isUniqueViolation } from '../platform/db-errors.ts'
import { allocateStaffId } from '../platform/settings.service.ts'
import {
  bumpStaffPinVersion,
  countOtherActiveAdmins,
  countStaffRows,
  deleteUserRow,
  findCredentialPassword,
  findStaffById,
  findUserById,
  findUserIdByEmail,
  revokeStaffBindings,
  selectStaffPage,
  selectStaffPinState,
  updateCredentialPassword,
  updateStaffPin,
  updateUserRow,
} from './staff.repository.ts'
import type {
  ChangeOwnPasswordInput,
  CreateStaffInput,
  CreateStaffResult,
  InvitationData,
  ListStaffFilters,
  ResetPasswordResult,
  ResetPinResult,
  SetPinResult,
  StaffPinState,
  StaffRow,
  UpdateStaffInput,
} from './staff.types.ts'

const PASSWORD_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
const TEMPORARY_PASSWORD_LENGTH = 16

export function generateTemporaryPassword(): string {
  let password = ''
  for (let index = 0; index < TEMPORARY_PASSWORD_LENGTH; index += 1) {
    password += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)]
  }
  return password
}

/**
 * A six-digit temporary POS PIN. The shared policy rejects repeated digits and
 * straight sequences, so generation retries until the value passes the same
 * check the console applies to a manually chosen PIN.
 */
export function generateTemporaryPin(): string {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const pin = String(randomInt(0, 1_000_000)).padStart(6, '0')
    if (pinProblem(pin) === null) return pin
  }
  throw new AppError(500, 'INTERNAL', 'Could not generate a temporary PIN')
}

async function sendInvitation(data: InvitationData): Promise<boolean> {
  const loginUrl = `${env.ADMIN_URL}/login`
  const lines = [`Hello ${data.name},`, '']

  if (data.temporaryPassword) {
    lines.push('An account has been created for you on Sceptre Drive.', '')
  } else if (data.temporaryPin) {
    lines.push('Your Sceptre Drive POS PIN has been reset.', '')
  }

  if (data.staffId) lines.push(`Staff ID: ${data.staffId}`)
  if (data.role) {
    const roleLabels: Record<string, string> = {
      ADMIN: 'Administrator',
      MANAGER: 'Manager',
      CASHIER: 'Cashier',
    }
    lines.push(`Role: ${roleLabels[data.role] ?? data.role}`)
  }
  if (data.staffId || data.role) lines.push('')

  if (data.temporaryPassword) {
    lines.push(
      'Console sign-in:',
      `  ${loginUrl}`,
      `  Email: ${data.to}`,
      `  Temporary password: ${data.temporaryPassword}`,
      '',
    )
  }

  if (data.temporaryPin) {
    lines.push(
      'Till sign-in:',
      '  Use your staff ID (or email) and this temporary PIN:',
      `  Temporary PIN: ${data.temporaryPin}`,
      '',
    )
  }

  if (data.temporaryPassword) {
    lines.push('Choose a new password at your first console sign-in.')
  }
  if (data.temporaryPin) {
    lines.push('Choose a new PIN at your first till sign-in.')
  }
  lines.push('', 'If you did not expect this, tell your administrator.')

  try {
    await email.send({
      to: data.to,
      subject:
        data.temporaryPin && !data.temporaryPassword
          ? 'Your Sceptre Drive POS PIN was reset'
          : 'Your Sceptre Drive account',
      text: lines.join('\n'),
    })
    return true
  } catch (error) {
    logger.error({ err: error }, 'failed to send staff invitation email')
    return false
  }
}

async function assertBranchUsable(user: SessionUser, branchId: string): Promise<void> {
  const found = await branchesService.getBranch(user, branchId)
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

async function assertNotLastAdmin(
  excludeUserId: string,
  executor: Parameters<typeof countOtherActiveAdmins>[1],
): Promise<void> {
  const others = await countOtherActiveAdmins(excludeUserId, executor)
  if (others === 0) {
    throw new ConflictError('The last active admin cannot be removed or demoted')
  }
}

/** A manager may only reset PINs for cashiers, mirroring the password rule. */
function assertCanManagePin(
  actorUser: SessionUser,
  target: { branchId: string | null; role: string },
): void {
  if (roleOf(actorUser) === 'ADMIN') return
  assertBranchAccess(actorUser, target.branchId ?? '')
  if (target.role !== 'CASHIER') {
    throw new ForbiddenError('Managers can only reset cashier PINs')
  }
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
  if (branchId) await assertBranchUsable(actorUser, branchId)

  const emailAddress = input.email.trim().toLowerCase()
  const existing = await findUserIdByEmail(emailAddress)
  if (existing) throw new ConflictError('A user with this email already exists')

  const staffId = await allocateStaffId(db)
  const temporaryPassword = generateTemporaryPassword()
  // Managers can authorize at the till as well as cashiers, so both get a
  // temporary PIN. Admins can still use the manual API path if they want to
  // put a specific PIN on an account; their own account is not branch-bound.
  const temporaryPin =
    input.role === 'CASHIER' || input.role === 'MANAGER' ? generateTemporaryPin() : null
  const pinHash = temporaryPin ? await hashPassword(temporaryPin) : null

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
      const updated = await updateUserRow(
        createdUserId,
        {
          role: input.role,
          branchId,
          staffId,
          phone: input.phone ?? null,
          mustChangePassword: true,
          ...(pinHash ? { pinHash, pinVersion: 1, pinMustChange: true } : {}),
        },
        tx,
      )
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
            hasPin: pinHash !== null,
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
      staffId: staff.staffId,
      role: staff.role,
      temporaryPassword,
      temporaryPin: temporaryPin ?? undefined,
    })

    return { staff, temporaryPassword, temporaryPin, invitationSent }
  } catch (error) {
    await deleteUserRow(createdUserId).catch((cleanupError) => {
      logger.error({ err: cleanupError, userId: createdUserId }, 'failed to clean up staff user')
    })
    throw error
  }
}

export async function listStaff(
  actorUser: SessionUser,
  filters: ListStaffFilters,
): Promise<{ staff: StaffRow[]; total: number }> {
  const scope = branchScope(actorUser)
  const queryScope = {
    branchId: scope ?? filters.branchId ?? null,
    role: filters.role,
    includeInactive: filters.includeInactive,
    search: filters.search,
  }

  const staff = await selectStaffPage(queryScope, { limit: filters.limit, offset: filters.offset })
  const total = await countStaffRows(queryScope)
  return { staff, total }
}

export async function getStaff(actorUser: SessionUser, id: string): Promise<StaffRow> {
  const found = await findStaffById(id)
  if (!found) throw new NotFoundError('Staff member not found')
  const scope = branchScope(actorUser)
  if (scope && found.branchId !== scope) {
    throw new ForbiddenError('You can only access your own branch')
  }
  return found
}

export async function updateStaff(
  actorUser: SessionUser,
  actor: AuditActor,
  id: string,
  input: UpdateStaffInput,
): Promise<StaffRow> {
  const actorRole = roleOf(actorUser)

  return db.transaction(async (tx) => {
    const target = await findUserById(id, tx)
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
    if (nextBranchId && nextBranchId !== target.branchId) {
      await assertBranchUsable(actorUser, nextBranchId)
    }

    if (target.role === 'ADMIN' && nextRole !== 'ADMIN') {
      await assertNotLastAdmin(target.id, tx)
    }

    const updated = await updateUserRow(
      id,
      {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.role !== undefined ? { role: input.role } : {}),
        ...(input.branchId !== undefined ? { branchId: input.branchId } : {}),
      },
      tx,
    )
    if (!updated) throw new AppError(500, 'INTERNAL', 'Failed to update staff member')

    // A role or branch change alters what a cached terminal binding is allowed
    // to do, so every binding is revoked and terminals must re-authorize.
    const identityChanged = nextRole !== target.role || nextBranchId !== target.branchId
    if (identityChanged) {
      await bumpStaffPinVersion(id, tx)
      await revokeStaffBindings(id, actor.actorStaffId ?? actor.actorId, tx)
    }

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
): Promise<StaffRow> {
  const actorRole = roleOf(actorUser)

  return db.transaction(async (tx) => {
    const target = await findUserById(id, tx)
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

    if (target.isActive === isActive) {
      const current = await findStaffById(id, tx)
      if (!current) throw new NotFoundError('Staff member not found')
      return current
    }

    const updated = await updateUserRow(id, { isActive }, tx)
    if (!updated) throw new AppError(500, 'INTERNAL', 'Failed to update staff member')

    if (!isActive) {
      await revokeUserSessions(target.id, {}, tx)
      // Deactivation keeps the hash (reactivation must not need a new PIN) but
      // invalidates every terminal binding and every cached PIN version.
      await bumpStaffPinVersion(target.id, tx)
      await revokeStaffBindings(target.id, actor.actorStaffId ?? actor.actorId, tx)
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

export async function resetStaffPassword(
  actorUser: SessionUser,
  actor: AuditActor,
  id: string,
): Promise<ResetPasswordResult> {
  const actorRole = roleOf(actorUser)
  const temporaryPassword = generateTemporaryPassword()
  const passwordHash = await hashPassword(temporaryPassword)

  const target = await db.transaction(async (tx) => {
    const found = await findUserById(id, tx)
    if (!found) throw new NotFoundError('Staff member not found')

    if (actorRole !== 'ADMIN') {
      assertBranchAccess(actorUser, found.branchId ?? '')
      if (found.role !== 'CASHIER') {
        throw new ForbiddenError('Managers can only reset cashier passwords')
      }
    }

    await updateCredentialPassword(id, passwordHash, tx)
    await updateUserRow(id, { mustChangePassword: true }, tx)
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
    staffId: target.staffId,
    role: target.role,
    temporaryPassword,
  })

  return { temporaryPassword, invitationSent }
}

/**
 * Sets a temporary PIN chosen by an admin/manager. The PIN is hashed with the
 * same Argon2id profile as passwords; the version bump plus binding revocation
 * forces every terminal that cached the previous PIN to re-authorize online.
 */
export async function setStaffPin(
  actorUser: SessionUser,
  actor: AuditActor,
  id: string,
  pin: string,
): Promise<SetPinResult> {
  const pinHash = await hashPassword(pin)

  return db.transaction(async (tx) => {
    const target = await findUserById(id, tx)
    if (!target) throw new NotFoundError('Staff member not found')

    assertCanManagePin(actorUser, target)

    if (!target.isActive) {
      throw new ConflictError('Cannot set a PIN for a deactivated staff member')
    }
    if (!target.staffId) {
      throw new ConflictError('This account has no staff ID and cannot use a POS terminal')
    }

    const updated = await updateStaffPin(id, pinHash, tx)
    if (!updated) throw new AppError(500, 'INTERNAL', 'Failed to set the staff PIN')

    const revoked = await revokeStaffBindings(target.id, actor.actorStaffId ?? actor.actorId, tx)

    // Never audit the PIN or its hash: only the version and binding count.
    await writeAudit(
      {
        ...actor,
        action: 'staff.pin.reset',
        entity: 'user',
        entityId: target.id,
        after: {
          staffId: target.staffId,
          pinVersion: updated.pinVersion,
          revokedBindings: revoked,
          pinMustChange: true,
        },
        branchId: target.branchId,
      },
      tx,
    )

    return { staffId: target.staffId, pinVersion: updated.pinVersion }
  })
}

/**
 * Generates a new temporary PIN, revokes every terminal binding, and emails it.
 * The plain PIN is returned once for the one-time console dialog; only its hash
 * is stored.
 */
export async function resetStaffPin(
  actorUser: SessionUser,
  actor: AuditActor,
  id: string,
): Promise<ResetPinResult> {
  const temporaryPin = generateTemporaryPin()
  const pinHash = await hashPassword(temporaryPin)

  const result = await db.transaction(async (tx) => {
    const target = await findUserById(id, tx)
    if (!target) throw new NotFoundError('Staff member not found')

    assertCanManagePin(actorUser, target)

    if (!target.isActive) {
      throw new ConflictError('Cannot reset a PIN for a deactivated staff member')
    }
    const staffId = target.staffId
    if (!staffId) {
      throw new ConflictError('This account has no staff ID and cannot use a POS terminal')
    }

    const updated = await updateStaffPin(id, pinHash, tx)
    if (!updated) throw new AppError(500, 'INTERNAL', 'Failed to reset the staff PIN')

    const revoked = await revokeStaffBindings(target.id, actor.actorStaffId ?? actor.actorId, tx)

    // Never audit the PIN or its hash: only the version and binding count.
    await writeAudit(
      {
        ...actor,
        action: 'staff.pin.reset',
        entity: 'user',
        entityId: target.id,
        after: {
          staffId,
          pinVersion: updated.pinVersion,
          revokedBindings: revoked,
          pinMustChange: true,
        },
        branchId: target.branchId,
      },
      tx,
    )

    return { target, staffId, pinVersion: updated.pinVersion }
  })

  const invitationSent = await sendInvitation({
    to: result.target.email,
    name: result.target.name,
    staffId: result.staffId,
    role: result.target.role,
    temporaryPin,
  })

  return {
    staffId: result.staffId,
    pinVersion: result.pinVersion,
    temporaryPin,
    invitationSent,
  }
}

/** PIN metadata for the console badge and dialog; never returns the hash. */
export async function getStaffPinState(actorUser: SessionUser, id: string): Promise<StaffPinState> {
  const target = await findUserById(id)
  if (!target) throw new NotFoundError('Staff member not found')

  if (roleOf(actorUser) !== 'ADMIN') {
    assertBranchAccess(actorUser, target.branchId ?? '')
  }

  const state = await selectStaffPinState(target.id)
  if (!state) throw new NotFoundError('Staff member not found')
  return state
}

export async function changeOwnPassword(
  user: SessionUser,
  session: SessionData,
  actor: AuditActor,
  input: ChangeOwnPasswordInput,
): Promise<void> {
  const stored = await findCredentialPassword(user.id)
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
    await updateCredentialPassword(user.id, newHash, tx)
    await updateUserRow(user.id, { mustChangePassword: false }, tx)
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
