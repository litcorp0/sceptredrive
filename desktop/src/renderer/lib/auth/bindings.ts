import type { PowerSyncDatabase } from '@powersync/web'
import { isRole, type Role } from '@sceptre/shared'
import { ApiError, apiRequest } from '../api/client'
import type { PosBindingValidationPayload, PosStaffBindingPayload } from '../api/types'
import {
  afterFailure,
  afterSuccess,
  createPinSalt,
  hashPin,
  isLocked,
  type LockoutPolicy,
  normalizeLockout,
  remainingAttempts,
  verifyPinHash,
} from './pin'

/**
 * Device-side staff bindings.
 *
 * One row per authorized staff member in the local-only `staff_binding` table.
 * The server binding token is stored here (the database is encrypted with a
 * safeStorage-held key) and is sent as `x-pos-binding` when the terminal talks
 * to the server about that staff member.
 */

export type BindingErrorCode =
  | 'INVALID'
  | 'LOCKED'
  | 'INACTIVE'
  | 'EXPIRED'
  | 'OFFLINE'
  | 'NOT_FOUND'

export class BindingError extends Error {
  readonly code: BindingErrorCode
  readonly lockedUntil: string | null
  readonly remainingAttempts: number | null

  constructor(
    code: BindingErrorCode,
    message: string,
    extra: { lockedUntil?: string | null; remainingAttempts?: number | null } = {},
  ) {
    super(message)
    this.name = 'BindingError'
    this.code = code
    this.lockedUntil = extra.lockedUntil ?? null
    this.remainingAttempts = extra.remainingAttempts ?? null
  }
}

export interface LocalStaffBinding {
  id: string
  userId: string
  staffId: string
  name: string
  role: Role
  bindingId: string
  /** Server credential; encrypted at rest with the local database. */
  bindingToken: string
  expiresAt: string
  pinSalt: string
  pinVerifier: string
  pinVersion: number
  /** A manager set a temporary PIN; change it before selling. */
  pinMustChange: boolean
  failedAttempts: number
  lockedUntil: string | null
  isActive: boolean
  boundAt: string
}

interface BindingRow {
  id: string
  user_id: string
  staff_id: string
  name: string
  role: string
  binding_id: string
  binding_token: string
  expires_at: string
  pin_salt: string
  pin_verifier: string
  pin_version: number
  pin_must_change: number
  failed_attempts: number
  locked_until: string | null
  is_active: number
  bound_at: string
}

const COLUMNS = `id, user_id, staff_id, name, role, binding_id, binding_token, expires_at,
  pin_salt, pin_verifier, pin_version, pin_must_change, failed_attempts, locked_until, is_active,
  bound_at`

function toBinding(row: BindingRow): LocalStaffBinding | null {
  if (!isRole(row.role)) return null
  return {
    id: row.id,
    userId: row.user_id,
    staffId: row.staff_id,
    name: row.name,
    role: row.role,
    bindingId: row.binding_id,
    bindingToken: row.binding_token,
    expiresAt: row.expires_at,
    pinSalt: row.pin_salt,
    pinVerifier: row.pin_verifier,
    pinVersion: row.pin_version,
    pinMustChange: row.pin_must_change === 1,
    failedAttempts: row.failed_attempts,
    lockedUntil: row.locked_until,
    isActive: row.is_active === 1,
    boundAt: row.bound_at,
  }
}

function backendUnavailable(): BindingError {
  return new BindingError('OFFLINE', 'Connect to the office network to authorize this staff member')
}

/** Inserts or replaces the local row for one server binding (one per staff). */
async function storeBinding(db: PowerSyncDatabase, binding: LocalStaffBinding): Promise<void> {
  await db.writeTransaction(async (tx) => {
    await tx.execute('DELETE FROM staff_binding WHERE user_id = ?', [binding.userId])
    await tx.execute(
      `INSERT INTO staff_binding (${COLUMNS})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        binding.id,
        binding.userId,
        binding.staffId,
        binding.name,
        binding.role,
        binding.bindingId,
        binding.bindingToken,
        binding.expiresAt,
        binding.pinSalt,
        binding.pinVerifier,
        binding.pinVersion,
        binding.pinMustChange ? 1 : 0,
        binding.failedAttempts,
        binding.lockedUntil,
        binding.isActive ? 1 : 0,
        binding.boundAt,
      ],
    )
  })
}

function bindingFromRemote(
  remote: PosStaffBindingPayload,
  pinVerifier: string,
  pinSalt: string,
): LocalStaffBinding {
  return {
    id: remote.bindingId,
    userId: remote.staff.userId,
    staffId: remote.staff.staffId,
    name: remote.staff.name,
    role: remote.staff.role,
    bindingId: remote.bindingId,
    bindingToken: remote.bindingToken,
    expiresAt: remote.expiresAt,
    pinSalt,
    pinVerifier,
    pinVersion: remote.pinVersion,
    pinMustChange: remote.mustChangePin,
    failedAttempts: 0,
    lockedUntil: null,
    isActive: true,
    boundAt: new Date().toISOString(),
  }
}

/** Authorize a staff member online and cache a device-bound verifier. */
export async function activateBinding(
  db: PowerSyncDatabase,
  input: { staffCodeOrEmail: string; pin: string },
): Promise<LocalStaffBinding> {
  const selector = input.staffCodeOrEmail.trim()
  const identity = selector.includes('@') ? { email: selector } : { staffCode: selector }

  let remote: PosStaffBindingPayload
  try {
    remote = await apiRequest<PosStaffBindingPayload>('/api/pos/staff/authorize', {
      method: 'POST',
      body: { ...identity, pin: input.pin },
    })
  } catch (error) {
    if (error instanceof ApiError && error.status === 0) throw backendUnavailable()
    throw error
  }

  const pinSalt = createPinSalt()
  const pinVerifier = await hashPin(input.pin, pinSalt)
  const binding = bindingFromRemote(remote, pinVerifier, pinSalt)
  await storeBinding(db, binding)
  return binding
}

export async function listBindings(db: PowerSyncDatabase): Promise<LocalStaffBinding[]> {
  const rows = await db.getAll<BindingRow>(
    `SELECT ${COLUMNS} FROM staff_binding WHERE is_active = 1 ORDER BY name`,
  )
  return rows.map(toBinding).filter((row): row is LocalStaffBinding => row !== null)
}

export async function getBinding(
  db: PowerSyncDatabase,
  bindingId: string,
): Promise<LocalStaffBinding | null> {
  const row = await db.getOptional<BindingRow>(
    `SELECT ${COLUMNS} FROM staff_binding WHERE id = ?`,
    [bindingId],
  )
  return row ? toBinding(row) : null
}

async function persistLockout(
  db: PowerSyncDatabase,
  bindingId: string,
  state: { failedAttempts: number; lockedUntil: string | null },
): Promise<void> {
  await db.execute(`UPDATE staff_binding SET failed_attempts = ?, locked_until = ? WHERE id = ?`, [
    state.failedAttempts,
    state.lockedUntil,
    bindingId,
  ])
}

export async function markBindingInactive(db: PowerSyncDatabase, bindingId: string): Promise<void> {
  await db.execute(`UPDATE staff_binding SET is_active = 0 WHERE id = ?`, [bindingId])
}

/**
 * Offline verification with per-binding lockout. A manager's counters are their
 * own row, so unlocking a cashier never resets the manager's own attempts.
 */
export async function verifyOfflinePin(
  db: PowerSyncDatabase,
  bindingId: string,
  pin: string,
  policy: LockoutPolicy,
): Promise<LocalStaffBinding> {
  const binding = await getBinding(db, bindingId)
  if (!binding) throw new BindingError('NOT_FOUND', 'This staff member is not authorized here')
  if (!binding.isActive) {
    throw new BindingError('INACTIVE', 'This binding is no longer active; authorize again online')
  }

  const lockout = normalizeLockout({
    failedAttempts: binding.failedAttempts,
    lockedUntil: binding.lockedUntil,
  })
  if (isLocked(lockout)) {
    throw new BindingError('LOCKED', 'Too many wrong PINs', { lockedUntil: lockout.lockedUntil })
  }
  if (Date.parse(binding.expiresAt) <= Date.now()) {
    await markBindingInactive(db, bindingId)
    throw new BindingError('EXPIRED', 'This binding has expired; connect to authorize again')
  }

  const valid = await verifyPinHash(binding.pinVerifier, pin, binding.pinSalt)
  if (!valid) {
    const next = afterFailure(lockout, policy)
    await persistLockout(db, bindingId, next)
    if (next.lockedUntil) {
      throw new BindingError('LOCKED', 'Too many wrong PINs', { lockedUntil: next.lockedUntil })
    }
    throw new BindingError('INVALID', 'Wrong PIN', {
      remainingAttempts: remainingAttempts(next, policy),
    })
  }

  await persistLockout(db, bindingId, afterSuccess())
  return binding
}

/** A manager/admin binding clears a locked cashier binding. */
export async function unlockWithManagerPin(
  db: PowerSyncDatabase,
  targetBindingId: string,
  managerBindingId: string,
  pin: string,
  policy: LockoutPolicy,
): Promise<LocalStaffBinding> {
  if (targetBindingId === managerBindingId) {
    throw new BindingError('INVALID', 'Choose another manager to unlock this PIN')
  }

  const manager = await verifyOfflinePin(db, managerBindingId, pin, policy)
  if (manager.role !== 'MANAGER' && manager.role !== 'ADMIN') {
    throw new BindingError('INVALID', 'This staff member cannot unlock a terminal')
  }

  await persistLockout(db, targetBindingId, afterSuccess())
  return manager
}

/**
 * Change the PIN at the till. Requires the network because the server owns the
 * PIN hash and must invalidate the other terminals' bindings.
 */
export async function changePinOnline(
  db: PowerSyncDatabase,
  bindingId: string,
  currentPin: string,
  newPin: string,
): Promise<LocalStaffBinding> {
  const binding = await getBinding(db, bindingId)
  if (!binding) throw new BindingError('NOT_FOUND', 'This staff member is not authorized here')

  let remote: PosStaffBindingPayload
  try {
    remote = await apiRequest<PosStaffBindingPayload>('/api/pos/staff/change-pin', {
      method: 'POST',
      headers: { 'x-pos-binding': binding.bindingToken },
      body: { currentPin, newPin },
    })
  } catch (error) {
    if (error instanceof ApiError && error.status === 0) {
      throw new BindingError('OFFLINE', 'Connect to change this PIN. You can still sign in with it')
    }
    throw error
  }

  const pinSalt = createPinSalt()
  const pinVerifier = await hashPin(newPin, pinSalt)
  const updated = bindingFromRemote(remote, pinVerifier, pinSalt)
  await storeBinding(db, updated)
  return updated
}

/**
 * Boot-time check. `true` = live, `false` = dead (the row is marked inactive),
 * `null` = the server could not be reached (keep working offline).
 */
export async function validateBindingOnline(
  db: PowerSyncDatabase,
  bindingId: string,
): Promise<boolean | null> {
  const binding = await getBinding(db, bindingId)
  if (!binding) return false

  try {
    const result = await apiRequest<PosBindingValidationPayload>(
      '/api/pos/staff/binding/validate',
      {
        method: 'POST',
        headers: { 'x-pos-binding': binding.bindingToken },
      },
    )
    if (!result.valid || result.pinVersion !== binding.pinVersion) {
      await markBindingInactive(db, bindingId)
      return false
    }
    return true
  } catch (error) {
    if (error instanceof ApiError && error.status === 0) return null
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      await markBindingInactive(db, bindingId)
      return false
    }
    throw error
  }
}
