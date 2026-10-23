import { randomBytes } from 'node:crypto'
import { type DbExecutor, db } from '@gikautos/db'
import { hashPassword, verifyPassword } from '../../auth/password.ts'
import { AppError, ConflictError } from '../../http/errors.ts'
import { hashDeviceToken } from '../org/enrollment.service.ts'
import { writeAudit } from '../platform/audit.service.ts'
import type { DeviceAuthContext } from '../sync/sync.types.ts'
import {
  findActiveBinding,
  findBindingByTokenHash,
  findOpenShiftByTerminal,
  findShiftByIdForUpdate,
  findStaffForAuthorization,
  insertBinding,
  insertCashMovement,
  insertConflict,
  insertShift,
  lockTerminal,
  revokeBinding,
  revokeStaffBindings,
  selectShiftCashTotals,
  touchBinding,
  updateShiftClose,
  updateStaffPinHash,
} from './pos.repository.ts'
import type {
  BindingStaff,
  BindingValidationResult,
  CashMovementPayload,
  DeviceStaffRecord,
  ShiftApplyResult,
  ShiftCashTotals,
  ShiftClosePayload,
  ShiftOpenPayload,
  StaffBindingResult,
} from './pos.types.ts'

/** Bindings live for a quarter; a PIN reset or role change invalidates them sooner. */
export const BINDING_TTL_MS = 90 * 24 * 60 * 60 * 1000

/** 32 random bytes, URL-safe. Returned once and stored only as an HMAC. */
export function generateBindingToken(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * Every credential failure answers identically so a terminal cannot enumerate
 * staff, PINs, or branches. The audit row records which selector was used, never
 * the PIN.
 */
function invalidCredentials(): AppError {
  return new AppError(401, 'PIN_INVALID', 'Invalid staff credentials')
}

function invalidBinding(): AppError {
  return new AppError(401, 'BINDING_INVALID', 'This terminal binding is no longer valid')
}

function toBindingStaff(staff: DeviceStaffRecord): BindingStaff {
  return {
    userId: staff.userId,
    staffId: staff.staffId,
    name: staff.name,
    role: staff.role,
  }
}

async function verifyPin(staff: DeviceStaffRecord, pin: string): Promise<boolean> {
  if (!staff.pinHash) return false
  try {
    return await verifyPassword({ hash: staff.pinHash, password: pin })
  } catch {
    // A malformed stored hash is a failed verification, never a 500.
    return false
  }
}

async function auditAuthorizationFailure(
  auth: DeviceAuthContext,
  selector: { staffCode?: string | undefined; email?: string | undefined },
): Promise<void> {
  await writeAudit({
    action: 'pos.staff.authorize.failed',
    entity: 'device',
    entityId: auth.deviceId,
    after: {
      selector: selector.staffCode ? 'STAFF_CODE' : 'EMAIL',
      staffCodeProvided: Boolean(selector.staffCode),
      emailProvided: Boolean(selector.email),
    },
    branchId: auth.branchId,
    terminalId: auth.terminalId,
  })
}

export interface AuthorizeStaffInput {
  staffCode?: string | undefined
  email?: string | undefined
  pin: string
}

/**
 * Authorizes a staff member on this terminal and issues a device-bound binding.
 *
 * The raw binding token is returned exactly once; only `HMAC-SHA256(token)` is
 * stored, so a database leak cannot be replayed against a terminal.
 */
export async function authorizeStaff(
  auth: DeviceAuthContext,
  input: AuthorizeStaffInput,
): Promise<StaffBindingResult> {
  const staff = await findStaffForAuthorization({ staffCode: input.staffCode, email: input.email })

  if (!staff || !staff.isActive || !staff.pinHash) {
    await auditAuthorizationFailure(auth, input)
    throw invalidCredentials()
  }

  if (staff.role !== 'ADMIN' && (!staff.branchId || staff.branchId !== auth.branchId)) {
    await auditAuthorizationFailure(auth, input)
    throw invalidCredentials()
  }

  const valid = await verifyPin(staff, input.pin)
  if (!valid) {
    await auditAuthorizationFailure(auth, input)
    throw invalidCredentials()
  }

  const bindingToken = generateBindingToken()
  const expiresAt = new Date(Date.now() + BINDING_TTL_MS)

  const bindingId = await db.transaction(async (tx) => {
    // One active binding per (device, staff); the partial unique index enforces
    // it, and re-authorizing replaces the previous credential.
    const existing = await findActiveBinding(auth.deviceId, staff.userId, tx)
    if (existing) await revokeBinding(existing.id, `staff:${staff.staffId}`, tx)

    const binding = await insertBinding(
      {
        deviceId: auth.deviceId,
        staffUserId: staff.userId,
        staffStaffId: staff.staffId,
        role: staff.role,
        branchId: auth.branchId,
        pinVersion: staff.pinVersion,
        bindingTokenHash: hashDeviceToken(bindingToken),
        authorizedAt: new Date(),
        expiresAt,
      },
      tx,
    )

    // Never audit the token or the PIN.
    await writeAudit(
      {
        action: 'pos.staff.binding.created',
        entity: 'pos_staff_binding',
        entityId: binding.id,
        actorId: staff.userId,
        actorStaffId: staff.staffId,
        after: {
          deviceId: auth.deviceId,
          terminalId: auth.terminalId,
          role: staff.role,
          pinVersion: staff.pinVersion,
          mustChangePin: staff.pinMustChange,
          expiresAt: expiresAt.toISOString(),
        },
        branchId: auth.branchId,
        terminalId: auth.terminalId,
      },
      tx,
    )

    return binding.id
  })

  return {
    bindingId,
    bindingToken,
    expiresAt: expiresAt.toISOString(),
    staff: toBindingStaff(staff),
    pinVersion: staff.pinVersion,
    mustChangePin: staff.pinMustChange,
  }
}

/** A live binding whose staff, role, branch, and PIN version still agree with the server. */
function bindingIsLive(
  auth: DeviceAuthContext,
  binding: {
    deviceId: string
    branchId: string
    role: string
    pinVersion: number
    revokedAt: Date | null
    expiresAt: Date
  },
  staff: DeviceStaffRecord,
): boolean {
  if (binding.revokedAt) return false
  if (binding.expiresAt.getTime() <= Date.now()) return false
  if (!staff.isActive) return false
  if (binding.pinVersion !== staff.pinVersion) return false
  if (binding.deviceId !== auth.deviceId || binding.branchId !== auth.branchId) return false
  if (binding.role !== staff.role) return false
  if (staff.role !== 'ADMIN' && staff.branchId !== auth.branchId) return false
  return true
}

/** Used by change-PIN and (Plan 05) by uploads: resolves and validates in one step. */
export async function requireActiveBinding(
  auth: DeviceAuthContext,
  bindingToken: string,
): Promise<{ bindingId: string; staff: DeviceStaffRecord }> {
  const resolved = await findBindingByTokenHash(hashDeviceToken(bindingToken))
  if (!resolved) throw invalidBinding()
  if (!bindingIsLive(auth, resolved.binding, resolved.staff)) {
    throw new AppError(
      403,
      'STALE_CREDENTIALS',
      'This terminal binding is stale; authorize the staff member again',
    )
  }
  return { bindingId: resolved.binding.id, staff: resolved.staff }
}

export interface ChangePinInput {
  currentPin: string
  newPin: string
}

/**
 * Changes the staff PIN from the terminal, then replaces every binding: the
 * cashier stays signed in on this device with a fresh credential, and any other
 * terminal that cached the old PIN must re-authorize.
 */
export async function changeStaffPin(
  auth: DeviceAuthContext,
  bindingToken: string,
  input: ChangePinInput,
): Promise<StaffBindingResult> {
  const { staff } = await requireActiveBinding(auth, bindingToken)

  const currentValid = await verifyPin(staff, input.currentPin)
  if (!currentValid) {
    await writeAudit({
      action: 'staff.pin.change.failed',
      entity: 'user',
      entityId: staff.userId,
      after: { deviceId: auth.deviceId },
      branchId: auth.branchId,
      terminalId: auth.terminalId,
    })
    throw new AppError(401, 'PIN_INVALID', 'The current PIN is incorrect')
  }

  if (input.newPin === input.currentPin) {
    throw new AppError(400, 'PIN_UNCHANGED', 'The new PIN must be different from the current PIN')
  }

  const pinHash = await hashPassword(input.newPin)
  const bindingTokenNext = generateBindingToken()
  const expiresAt = new Date(Date.now() + BINDING_TTL_MS)

  const result = await db.transaction(async (tx) => {
    const pinVersion = await updateStaffPinHash(staff.userId, pinHash, tx)
    if (pinVersion === null) throw new AppError(500, 'INTERNAL', 'Failed to update the PIN')

    await revokeStaffBindings(staff.userId, `staff:${staff.staffId}`, tx)

    const binding = await insertBinding(
      {
        deviceId: auth.deviceId,
        staffUserId: staff.userId,
        staffStaffId: staff.staffId,
        role: staff.role,
        branchId: auth.branchId,
        pinVersion,
        bindingTokenHash: hashDeviceToken(bindingTokenNext),
        authorizedAt: new Date(),
        expiresAt,
      },
      tx,
    )

    await writeAudit(
      {
        action: 'staff.pin.changed',
        entity: 'user',
        entityId: staff.userId,
        actorId: staff.userId,
        actorStaffId: staff.staffId,
        after: { pinVersion, deviceId: auth.deviceId, bindingId: binding.id },
        branchId: auth.branchId,
        terminalId: auth.terminalId,
      },
      tx,
    )

    return { pinVersion, bindingId: binding.id }
  })

  return {
    bindingId: result.bindingId,
    bindingToken: bindingTokenNext,
    expiresAt: expiresAt.toISOString(),
    staff: toBindingStaff(staff),
    pinVersion: result.pinVersion,
    mustChangePin: false,
  }
}

/**
 * Boot-time check for a cached binding. Returns 200 with `valid: false` for a
 * dead binding so the device can route to re-authorization rather than treat it
 * as a network failure.
 */
export async function validateStaffBinding(
  auth: DeviceAuthContext,
  bindingToken: string,
): Promise<BindingValidationResult> {
  const resolved = await findBindingByTokenHash(hashDeviceToken(bindingToken))
  if (!resolved || !bindingIsLive(auth, resolved.binding, resolved.staff)) {
    return {
      valid: false,
      staff: null,
      pinVersion: null,
      mustChangePin: false,
      bindingId: null,
    }
  }

  await touchBinding(resolved.binding.id)

  return {
    valid: true,
    staff: toBindingStaff(resolved.staff),
    pinVersion: resolved.staff.pinVersion,
    mustChangePin: resolved.staff.pinMustChange,
    bindingId: resolved.binding.id,
  }
}

// --- Shift application (called by the Plan 05 upload dispatcher) -------------

/** Expected cash = float + cash tenders − change + cash in − cash out. */
export function computeExpectedCash(totals: ShiftCashTotals): number {
  return (
    totals.openingFloatMinor +
    totals.cashTendersMinor -
    totals.changeMinor +
    totals.cashInMinor -
    totals.cashOutMinor
  )
}

function parseOccurredAt(value: string): Date {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new AppError(400, 'INVALID_TIMESTAMP', 'occurredAt must be an ISO timestamp')
  }
  return date
}

function assertNonNegativeInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new AppError(400, 'INVALID_AMOUNT', `${field} must be a non-negative integer`)
  }
}

function assertShiftMatchesDevice(
  row: typeof import('./pos.schema.ts').shift.$inferSelect,
  device: DeviceAuthContext,
): void {
  if (
    row.terminalId !== device.terminalId ||
    row.branchId !== device.branchId ||
    row.deviceId !== device.deviceId
  ) {
    // A shift belongs to the terminal that opened it; another device syncing it
    // is an integrity failure, not a normal replay.
    throw new AppError(409, 'SHIFT_DEVICE_MISMATCH', 'This shift does not belong to this device')
  }
}

/**
 * Applies a shift open. The caller owns the transaction and idempotency; this
 * function validates the terminal chain and the one-open-shift invariant.
 */
export async function openShift(
  device: DeviceAuthContext,
  payload: ShiftOpenPayload,
  executor: DbExecutor = db,
): Promise<ShiftApplyResult> {
  const terminal = await lockTerminal(device.terminalId, executor)
  if (!terminal) {
    throw new AppError(404, 'TERMINAL_NOT_FOUND', 'Terminal not found')
  }
  if (!terminal.isActive) {
    throw new AppError(409, 'TERMINAL_INACTIVE', 'Terminal is not active')
  }
  if (terminal.branchId !== device.branchId) {
    throw new AppError(409, 'TERMINAL_BRANCH_MISMATCH', 'Terminal is not in this branch')
  }

  assertNonNegativeInteger(payload.openingFloatMinor, 'openingFloatMinor')
  const occurredAt = parseOccurredAt(payload.occurredAt)

  const existing = await findOpenShiftByTerminal(device.terminalId, executor)
  if (existing) {
    // The dispatcher replays before calling in; a same-id open is harmless, a
    // different id means another cashier is already selling on this till.
    if (existing.id === payload.shiftId) return { shiftId: existing.id }
    throw new ConflictError('A shift is already open on this terminal', {
      openShiftId: existing.id,
      openShiftNumber: existing.number,
    })
  }

  await insertShift(
    {
      id: payload.shiftId,
      number: payload.number,
      branchId: device.branchId,
      terminalId: device.terminalId,
      deviceId: device.deviceId,
      cashierUserId: payload.cashierUserId,
      cashierStaffId: payload.cashierStaffId,
      status: 'OPEN',
      openedAt: occurredAt,
      openingFloatMinor: payload.openingFloatMinor,
      openedBy: payload.cashierStaffId,
    },
    executor,
  )

  await writeAudit(
    {
      action: 'pos.shift.opened',
      entity: 'shift',
      entityId: payload.shiftId,
      actorId: payload.cashierUserId,
      actorStaffId: payload.cashierStaffId,
      after: {
        number: payload.number,
        openingFloatMinor: payload.openingFloatMinor,
        terminalId: device.terminalId,
        deviceId: device.deviceId,
        occurredAt: occurredAt.toISOString(),
      },
      branchId: device.branchId,
      terminalId: device.terminalId,
    },
    executor,
  )

  return { shiftId: payload.shiftId }
}

/** Applies one cash movement to an open shift on this device. */
export async function recordCashMovement(
  device: DeviceAuthContext,
  payload: CashMovementPayload,
  executor: DbExecutor = db,
): Promise<ShiftApplyResult> {
  const row = await findShiftByIdForUpdate(payload.shiftId, executor)
  if (!row) throw new AppError(404, 'SHIFT_NOT_FOUND', 'Shift not found')
  assertShiftMatchesDevice(row, device)
  if (row.status !== 'OPEN') {
    throw new ConflictError('The shift is already closed')
  }

  assertNonNegativeInteger(payload.amountMinor, 'amountMinor')
  if (payload.amountMinor === 0) {
    throw new AppError(400, 'INVALID_AMOUNT', 'A cash movement must be greater than zero')
  }
  if (payload.type !== 'CASH_IN' && payload.type !== 'CASH_OUT') {
    throw new AppError(400, 'INVALID_CASH_MOVEMENT', 'Unknown cash movement type')
  }
  if (!payload.reason.trim()) {
    throw new AppError(400, 'INVALID_CASH_MOVEMENT', 'A cash movement needs a reason')
  }

  await insertCashMovement(
    {
      id: payload.id,
      shiftId: payload.shiftId,
      branchId: device.branchId,
      terminalId: device.terminalId,
      deviceId: device.deviceId,
      type: payload.type,
      amountMinor: payload.amountMinor,
      reason: payload.reason,
      occurredAt: parseOccurredAt(payload.occurredAt),
      staffUserId: payload.staffUserId,
      staffStaffId: payload.staffStaffId,
    },
    executor,
  )

  await writeAudit(
    {
      action: 'pos.cash.movement',
      entity: 'cash_movement',
      entityId: payload.id,
      actorId: payload.staffUserId,
      actorStaffId: payload.staffStaffId,
      after: {
        shiftId: payload.shiftId,
        type: payload.type,
        amountMinor: payload.amountMinor,
        reason: payload.reason,
      },
      branchId: device.branchId,
      terminalId: device.terminalId,
    },
    executor,
  )

  return { shiftId: payload.shiftId }
}

/**
 * Closes a shift with the server's own expected cash. The client's expected
 * value is stored beside it; a difference raises a reconciliation conflict but
 * never blocks the close.
 */
export async function closeShift(
  device: DeviceAuthContext,
  payload: ShiftClosePayload,
  executor: DbExecutor = db,
): Promise<ShiftApplyResult> {
  const row = await findShiftByIdForUpdate(payload.shiftId, executor)
  if (!row) throw new AppError(404, 'SHIFT_NOT_FOUND', 'Shift not found')
  assertShiftMatchesDevice(row, device)
  if (row.status !== 'OPEN') {
    throw new ConflictError('The shift is already closed')
  }

  assertNonNegativeInteger(payload.countedCashMinor, 'countedCashMinor')
  assertNonNegativeInteger(payload.clientExpectedCashMinor, 'clientExpectedCashMinor')

  const totals = await selectShiftCashTotals(payload.shiftId, row.openingFloatMinor, executor)
  const serverExpected = computeExpectedCash(totals)
  const variance = payload.countedCashMinor - serverExpected
  const closedAt = parseOccurredAt(payload.occurredAt)

  let conflictId: string | undefined
  if (payload.clientExpectedCashMinor !== serverExpected) {
    const conflict = await insertConflict(
      {
        branchId: device.branchId,
        terminalId: device.terminalId,
        deviceId: device.deviceId,
        shiftId: payload.shiftId,
        type: 'SHIFT_VARIANCE_MISMATCH',
        severity: 'MEDIUM',
        status: 'OPEN',
        details: {
          clientExpectedCashMinor: payload.clientExpectedCashMinor,
          serverExpectedCashMinor: serverExpected,
          countedCashMinor: payload.countedCashMinor,
          varianceMinor: variance,
          cashTendersMinor: totals.cashTendersMinor,
          changeMinor: totals.changeMinor,
          cashInMinor: totals.cashInMinor,
          cashOutMinor: totals.cashOutMinor,
        },
      },
      executor,
    )
    conflictId = conflict.id
  }

  await updateShiftClose(
    payload.shiftId,
    {
      status: 'CLOSED',
      closedAt,
      countedCashMinor: payload.countedCashMinor,
      clientExpectedCashMinor: payload.clientExpectedCashMinor,
      serverExpectedCashMinor: serverExpected,
      varianceMinor: variance,
      closeNote: payload.closeNote ?? null,
      closedBy: row.cashierStaffId,
    },
    executor,
  )

  await writeAudit(
    {
      action: 'pos.shift.closed',
      entity: 'shift',
      entityId: payload.shiftId,
      actorId: row.cashierUserId,
      actorStaffId: row.cashierStaffId,
      after: {
        countedCashMinor: payload.countedCashMinor,
        clientExpectedCashMinor: payload.clientExpectedCashMinor,
        serverExpectedCashMinor: serverExpected,
        varianceMinor: variance,
        conflictId: conflictId ?? null,
        occurredAt: closedAt.toISOString(),
      },
      branchId: device.branchId,
      terminalId: device.terminalId,
    },
    executor,
  )

  return {
    shiftId: payload.shiftId,
    serverExpectedCashMinor: serverExpected,
    varianceMinor: variance,
    ...(conflictId ? { conflictId } : {}),
  }
}
