import { randomBytes } from 'node:crypto'
import { type DbExecutor, db } from '@sceptre/db'
import { can, priceCart, type TaxMode } from '@sceptre/shared'
import { hashPassword, verifyPassword } from '../../auth/password.ts'
import { AppError, ConflictError, NotFoundError, ValidationError } from '../../http/errors.ts'
import {
  registerDecisionHandler,
  registerSubjectLoader,
  requestApproval,
} from '../approvals/approvals.service.ts'
import { postEntryInTransaction as postCreditEntry } from '../credit/credit.service.ts'
import type { CreditOverrideReason } from '../credit/credit.types.ts'
import { resolveDraftCustomer } from '../customers/customers.service.ts'
import { postMovements } from '../inventory/inventory.service.ts'
import {
  postEntryInTransaction as postLoyaltyEntry,
  quoteRedeem,
} from '../loyalty/loyalty.service.ts'
import { hashDeviceToken } from '../org/enrollment.service.ts'
import { writeAudit } from '../platform/audit.service.ts'
import type { AuditActor } from '../platform/audit.types.ts'
import { getSettingValue } from '../platform/settings.service.ts'
import type { DeviceAuthContext } from '../sync/sync.types.ts'
import { addConflict } from './pos.conflicts.ts'
import { assessSaleTotals, loadSaleCatalog } from './pos.pricing.ts'
import {
  countShiftSales,
  findActiveBinding,
  findBindingById,
  findBindingByTokenHash,
  findCreditProfileRow,
  findOpenShiftByTerminal,
  findSaleByReceiptNumber,
  findShiftByIdForUpdate,
  findShiftWithTerminal,
  findStaffById,
  findStaffForAuthorization,
  findTerminalName,
  insertBinding,
  insertCashMovement,
  insertConflict,
  insertSale,
  insertSaleLines,
  insertSaleTenders,
  insertShift,
  lockTerminal,
  revokeBinding,
  revokeStaffBindings,
  selectShiftCashTotals,
  touchBinding,
  updateSaleConflictCount,
  updateShiftClose,
  updateShiftReview,
  updateStaffPinHash,
} from './pos.repository.ts'
import type {
  AppliedConflict,
  BindingStaff,
  BindingValidationResult,
  CashMovementPayload,
  DeviceStaffRecord,
  OverrideProof,
  SaleApplyResult,
  SaleContext,
  SalePayload,
  ShiftApplyResult,
  ShiftCashTotals,
  ShiftClosePayload,
  ShiftOpenPayload,
  StaffBindingResult,
  SyncConflictSeverity,
  SyncConflictType,
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

  // A drawer beyond the branch's tolerance gets a person's name on it (P12-D24).
  // Strictly greater: exactly at tolerance is not "beyond tolerance" (BRN-04).
  // The raise is inside the upload transaction, so a failure rolls the close back
  // and the outbox retries the idempotent close (P12-D27); the response shape is
  // unchanged, because the till never learns an approval exists (APR-06).
  const tolerance = await getSettingValue(
    'pos.shiftVarianceToleranceMinor',
    { branchId: row.branchId },
    executor,
  )

  if (Math.abs(variance) > tolerance) {
    await updateShiftReview(payload.shiftId, { reviewStatus: 'REQUIRED' }, executor)

    const terminalName = await findTerminalName(device.terminalId, executor)
    if (terminalName === null) {
      // A shift cannot outlive its terminal (FK restrict); treat it as an
      // integrity failure rather than raise a review with no subject.
      throw new AppError(500, 'INTERNAL', 'The shift terminal no longer exists')
    }

    const [cashier, saleCount] = await Promise.all([
      findStaffById(row.cashierUserId, executor),
      countShiftSales(payload.shiftId, executor),
    ])

    // The requester is the cashier who counted the drawer, not the device: that
    // is what makes the no-self-approval rule mean something (P12-D26).
    await requestApproval(
      auditActorFor({ userId: row.cashierUserId, staffId: row.cashierStaffId }),
      {
        type: 'SHIFT_VARIANCE_REVIEW',
        entityId: payload.shiftId,
        branchId: row.branchId,
        amountMinor: Math.abs(variance),
        deciderRole: 'MANAGER',
        deciderBranchId: row.branchId,
        note: payload.closeNote ?? null,
        // Everything the reviewer needs to tell a wrong drawer from a terminal
        // and server that disagreed about the arithmetic (P12-D24, §3).
        payload: {
          shiftId: payload.shiftId,
          shiftNumber: row.number,
          terminalName,
          cashierName: cashier?.name ?? null,
          openedAt: row.openedAt.toISOString(),
          closedAt: closedAt.toISOString(),
          saleCount,
          expectedMinor: serverExpected,
          clientExpectedMinor: payload.clientExpectedCashMinor,
          countedMinor: payload.countedCashMinor,
          varianceMinor: variance,
        },
      },
      executor,
    )
  }

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

// --- Offline sale application ------------------------------------------------

type CashierRole = 'ADMIN' | 'MANAGER' | 'CASHIER'

const CREDIT_OVERRIDE_REASONS: Record<string, CreditOverrideReason> = {
  CUSTOMER_REQUEST: 'TEMPORARY_APPROVAL',
  APPROVED: 'TRUSTED_CUSTOMER',
  URGENT_NEED: 'URGENT_NEED',
  OTHER: 'OTHER',
  TEMPORARY_APPROVAL: 'TEMPORARY_APPROVAL',
  TRUSTED_CUSTOMER: 'TRUSTED_CUSTOMER',
}

interface PendingConflict {
  type: SyncConflictType
  severity: SyncConflictSeverity
  details: Record<string, unknown>
}

interface OverrideValidation {
  valid: boolean
  actor: AuditActor | null
  reasonCode: CreditOverrideReason | null
}

function auditActorFor(staff: { userId: string; staffId: string }): AuditActor {
  return {
    actorId: staff.userId,
    actorStaffId: staff.staffId,
    ip: null,
    userAgent: null,
    requestId: null,
  }
}

function saleRejected(code: string, message: string, details?: Record<string, unknown>): AppError {
  return new AppError(400, code, message, details)
}

/**
 * Revalidates a manager approval captured offline (D22): the binding must be
 * live on this device, the staff active with the permission, and the manager
 * branch-scoped. A stale or forged proof never blocks the sale; the caller
 * records OVERRIDE_INVALID and applies it anyway.
 */
async function validateOverrideProof(
  tx: DbExecutor,
  device: DeviceAuthContext,
  proof: OverrideProof | null | undefined,
  permission: 'pos.discount' | 'credit.override',
): Promise<OverrideValidation> {
  const invalid: OverrideValidation = { valid: false, actor: null, reasonCode: null }
  if (!proof) return invalid

  const binding = await findBindingById(proof.bindingId, tx)
  if (!binding) return invalid

  const staff = await findStaffById(binding.staffUserId, tx)
  if (!staff || !staff.isActive) return invalid

  const live =
    binding.deviceId === device.deviceId &&
    binding.revokedAt === null &&
    binding.expiresAt.getTime() > Date.now() &&
    binding.staffUserId === proof.userId &&
    binding.staffStaffId === proof.staffId &&
    binding.role === staff.role &&
    binding.pinVersion === proof.pinVersion &&
    (staff.role === 'ADMIN' || staff.branchId === device.branchId) &&
    can(staff.role, permission)

  if (!live) return invalid

  return {
    valid: true,
    actor: auditActorFor(staff),
    reasonCode:
      permission === 'credit.override' ? (CREDIT_OVERRIDE_REASONS[proof.reasonCode] ?? null) : null,
  }
}

/** Shape rules the route schema also enforces; keeps direct service calls safe. */
function assertSaleShape(payload: SalePayload): void {
  if (!Array.isArray(payload.lines) || payload.lines.length === 0) {
    throw saleRejected('SALE_INVALID', 'A sale needs at least one line')
  }
  if (!payload.receiptNumber?.trim() || payload.receiptNumber.length > 64) {
    throw saleRejected('SALE_INVALID', 'A sale needs a valid receipt number')
  }
  for (const line of payload.lines) {
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > 10_000) {
      throw saleRejected('SALE_INVALID', 'Line quantities must be between 1 and 10,000')
    }
    if (
      !Number.isSafeInteger(line.unitPriceMinor) ||
      line.unitPriceMinor < 0 ||
      line.unitPriceMinor > 1_000_000_000
    ) {
      throw saleRejected('SALE_INVALID', 'Unit prices must be whole pesewas within range')
    }
    if (!Number.isSafeInteger(line.lineDiscountMinor) || line.lineDiscountMinor < 0) {
      throw saleRejected('SALE_INVALID', 'Line discounts must be non-negative whole pesewas')
    }
    if (line.lineDiscountMinor > line.unitPriceMinor * line.quantity) {
      throw saleRejected('SALE_INVALID', 'A line discount cannot exceed the line gross')
    }
  }
}

/**
 * Applies one offline sale in the caller's transaction.
 *
 * Business conflicts (price drift, oversell, credit, loyalty, stale binding,
 * clock skew) are recorded and the sale still applies. Only integrity failures
 * (unknown product, impossible shift, internally inconsistent totals/tenders)
 * throw, which the upload dispatcher turns into a REJECTED reservation.
 */
export async function applySale(
  context: SaleContext,
  payload: SalePayload,
  executor: DbExecutor = db,
): Promise<SaleApplyResult> {
  assertSaleShape(payload)
  const device = context.device
  const saleId = context.clientTransactionId
  const receiptNumber = payload.receiptNumber.trim()
  const occurredAt = parseOccurredAt(payload.occurredAt)
  const pending: PendingConflict[] = []
  const applied: AppliedConflict[] = []
  const overrides: Array<{
    kind: 'DISCOUNT' | 'CREDIT'
    validation: OverrideValidation
    percent?: number
  }> = []

  // 1. Shift: the sale belongs to an open shift on this terminal.
  const shiftRow = await findShiftByIdForUpdate(payload.shiftId, executor)
  if (!shiftRow) {
    throw saleRejected('SHIFT_MISSING', 'The sale references a shift that does not exist')
  }
  if (shiftRow.branchId !== device.branchId || shiftRow.deviceId !== device.deviceId) {
    throw saleRejected('SHIFT_DEVICE_MISMATCH', 'The shift does not belong to this device')
  }
  if (shiftRow.terminalId !== device.terminalId) {
    throw saleRejected('SHIFT_DEVICE_MISMATCH', 'The shift does not belong to this terminal')
  }
  if (shiftRow.status !== 'OPEN') {
    throw saleRejected('SHIFT_CLOSED', 'The sale references a closed shift')
  }

  const existingSale = await findSaleByReceiptNumber(receiptNumber, executor)
  if (existingSale && existingSale.id !== saleId) {
    throw saleRejected('RECEIPT_CONFLICT', 'This receipt number is already used by another sale')
  }

  // 2. Staff credentials. A dead binding does not block the sale; it strips
  //    override authority and raises STALE_CREDENTIALS.
  let cashierUserId = payload.cashier.userId
  let cashierStaffId = payload.cashier.staffId
  let cashierRole: CashierRole = 'CASHIER'
  let bindingValid = false

  const resolvedBinding = await findBindingByTokenHash(
    hashDeviceToken(payload.cashier.bindingToken),
    executor,
  )
  if (
    resolvedBinding &&
    resolvedBinding.binding.id === payload.cashier.bindingId &&
    resolvedBinding.staff.userId === payload.cashier.userId &&
    resolvedBinding.staff.pinVersion === payload.cashier.pinVersion &&
    bindingIsLive(device, resolvedBinding.binding, resolvedBinding.staff)
  ) {
    bindingValid = true
    cashierUserId = resolvedBinding.staff.userId
    cashierStaffId = resolvedBinding.staff.staffId
    cashierRole = resolvedBinding.staff.role
  } else {
    pending.push({
      type: 'STALE_CREDENTIALS',
      severity: 'HIGH',
      details: {
        staffId: payload.cashier.staffId,
        bindingId: payload.cashier.bindingId,
        pinVersion: payload.cashier.pinVersion,
      },
    })
  }
  const actor = auditActorFor({ userId: cashierUserId, staffId: cashierStaffId })

  // 3. Catalogue and charged-price drift. The server never reprices.
  const catalog = await loadSaleCatalog(executor, device.branchId, payload.lines)
  if (catalog.missingProductIds.length > 0) {
    throw saleRejected('UNKNOWN_PRODUCT', 'One or more products no longer exist', {
      productIds: catalog.missingProductIds,
    })
  }

  for (const line of payload.lines) {
    const item = catalog.byProductId.get(line.productId)
    if (!item) throw saleRejected('UNKNOWN_PRODUCT', 'A product no longer exists')
    if (line.unitPriceMinor !== item.expectedUnitPriceMinor) {
      pending.push({
        type: 'PRICE_MISMATCH',
        severity: 'HIGH',
        details: {
          productId: line.productId,
          chargedUnitPriceMinor: line.unitPriceMinor,
          expectedUnitPriceMinor: item.expectedUnitPriceMinor,
          priceSource: item.priceSource,
        },
      })
    }
  }

  // 4. Customer draft (created offline) or walk-in.
  let resolvedCustomerId: string | null = null
  if (payload.customer) {
    const resolution = await resolveDraftCustomer(
      {
        id: payload.customer.id,
        name: payload.customer.name,
        phone: payload.customer.phone,
        branchId: device.branchId,
        actor,
      },
      executor,
    )
    if (resolution.status === 'INVALID_PHONE') {
      pending.push({
        type: 'INVALID_CUSTOMER',
        severity: 'LOW',
        details: { customerId: payload.customer.id },
      })
    } else {
      resolvedCustomerId = resolution.customer.id
      if (resolution.status === 'EXISTING_PHONE') {
        pending.push({
          type: 'DUPLICATE_CUSTOMER',
          severity: 'LOW',
          details: {
            draftCustomerId: payload.customer.id,
            existingCustomerId: resolution.customer.id,
          },
        })
      }
    }
  }

  // 5. Pricing with the charged money, server tax mode, and charged loyalty
  //    discount (the printed discount is part of the money).
  const taxMode = (await getSettingValue('pricing.taxMode', {}, executor)) as TaxMode
  const saleDiscountMinor = payload.saleDiscount?.amountMinor ?? 0
  const redeemPoints = payload.loyalty?.redeemPoints ?? 0
  const loyaltyDiscountMinor = redeemPoints > 0 ? payload.totals.loyaltyDiscountMinor : 0

  const priced = priceCart(
    payload.lines.map((line) => {
      const item = catalog.byProductId.get(line.productId)
      return {
        productId: line.productId,
        name: item?.name,
        sku: item?.sku,
        quantity: line.quantity,
        unitPriceMinor: line.unitPriceMinor,
        lineDiscountMinor: line.lineDiscountMinor,
        taxCategory: item?.taxCategory ?? line.taxCategory,
      }
    }),
    { taxMode, saleDiscountMinor, loyaltyDiscountMinor },
  )

  const computedTotals = {
    subtotalMinor: priced.subtotalMinor,
    lineDiscountMinor: priced.lineDiscountMinor,
    saleDiscountMinor: priced.saleDiscountMinor,
    loyaltyDiscountMinor: priced.loyaltyDiscountMinor,
    vatMinor: priced.vatMinor,
    nhilMinor: priced.nhilMinor,
    getfundMinor: priced.getfundMinor,
    taxTotalMinor: priced.taxTotalMinor,
    totalMinor: priced.totalMinor,
    changeMinor: 0,
  }

  // The charged change depends on the tender; compare the rest first.
  const assessment = assessSaleTotals(
    taxMode,
    { ...payload.totals, changeMinor: 0 },
    computedTotals,
  )
  if (!assessment.ok) {
    throw saleRejected('INVALID_TOTALS', assessment.reason, assessment.details)
  }
  if (!assessment.matched) {
    pending.push({
      type: 'TOTAL_MISMATCH',
      severity: 'HIGH',
      details: { charged: payload.totals, computed: computedTotals },
    })
  }
  const header = assessment.matched ? computedTotals : { ...payload.totals, changeMinor: 0 }

  // 6. Tender integrity (Phase 6 is single tender; zero due needs no tender).
  if (payload.tenders.length > 1) {
    throw saleRejected('INVALID_TENDER', 'Split tender is not supported in this phase')
  }
  const cashTender = payload.tenders.find((tender) => tender.method === 'CASH')
  const creditTender = payload.tenders.find((tender) => tender.method === 'CREDIT')
  const cashTendered = cashTender?.amountMinor ?? 0
  const creditAmount = creditTender?.amountMinor ?? 0
  const totalMinor = header.totalMinor

  if (totalMinor > 0 && payload.tenders.length !== 1) {
    throw saleRejected('INVALID_TENDER', 'A sale with a balance due needs one tender')
  }
  for (const tender of payload.tenders) {
    if (!Number.isSafeInteger(tender.amountMinor) || tender.amountMinor < 0) {
      throw saleRejected('INVALID_TENDER', 'Tender amounts must be non-negative whole pesewas')
    }
  }
  if (creditAmount > 0 && creditAmount !== totalMinor) {
    throw saleRejected('INVALID_TENDER', 'A credit tender must equal the sale total')
  }
  if (cashTendered > 0 && cashTendered < totalMinor) {
    throw saleRejected('INVALID_TENDER', 'The cash tendered is below the sale total')
  }
  if (creditAmount > 0 && !resolvedCustomerId) {
    throw saleRejected('CREDIT_REQUIRES_CUSTOMER', 'A credit sale needs a customer')
  }
  const changeMinor = cashTendered > totalMinor ? cashTendered - totalMinor : 0
  if (changeMinor !== payload.totals.changeMinor) {
    throw saleRejected('INVALID_TENDER', 'The change does not match the cash tendered')
  }

  // 7. Stock: append SALE movements, allowing oversell (conflict, never block).
  const quantities = new Map<string, number>()
  for (const line of payload.lines) {
    quantities.set(line.productId, (quantities.get(line.productId) ?? 0) + line.quantity)
  }
  const posted = await postMovements(
    actor,
    [...quantities.entries()].map(([productId, quantity]) => ({
      productId,
      branchId: device.branchId,
      type: 'SALE' as const,
      quantityDelta: -quantity,
      referenceType: 'SALE' as const,
      referenceId: saleId,
      referenceNumber: receiptNumber,
    })),
    { executor, allowNegative: true },
  )
  for (const [productId, level] of posted.levels) {
    if (level.quantityOnHand < 0) {
      pending.push({
        type: 'STOCK_OVERSELL',
        severity: 'HIGH',
        details: {
          productId,
          onHand: level.quantityOnHand,
          quantity: quantities.get(productId) ?? 0,
        },
      })
    }
  }

  // 8. Credit charge: always recorded, even when the offline policy was broken.
  if (creditAmount > 0 && resolvedCustomerId) {
    const profile = await findCreditProfileRow(resolvedCustomerId, device.branchId, executor)
    const held = profile?.hold ?? false
    const overLimit = profile
      ? profile.balanceMinor + creditAmount > profile.limitMinor
      : creditAmount > 0

    const proof = creditTender?.override
    const approval = await validateOverrideProof(executor, device, proof, 'credit.override')
    const creditReason = approval.valid ? approval.reasonCode : null

    if (held) {
      pending.push({
        type: 'CREDIT_HOLD',
        severity: 'HIGH',
        details: {
          customerId: resolvedCustomerId,
          amountMinor: creditAmount,
          balanceMinor: profile?.balanceMinor ?? 0,
          limitMinor: profile?.limitMinor ?? 0,
        },
      })
    }
    if (overLimit && !held && !(approval.valid && creditReason)) {
      pending.push({
        type: 'CREDIT_OVER_LIMIT',
        severity: 'HIGH',
        details: {
          customerId: resolvedCustomerId,
          amountMinor: creditAmount,
          balanceMinor: profile?.balanceMinor ?? 0,
          limitMinor: profile?.limitMinor ?? 0,
        },
      })
    }
    if (proof && (!approval.valid || !creditReason)) {
      pending.push({
        type: 'OVERRIDE_INVALID',
        severity: 'HIGH',
        details: {
          kind: 'CREDIT',
          staffId: proof.staffId,
          bindingId: proof.bindingId,
          reasonCode: proof.reasonCode,
        },
      })
    }
    if (approval.valid && !held) overrides.push({ kind: 'CREDIT', validation: approval })

    await postCreditEntry(
      executor,
      actor,
      null,
      {
        customerId: resolvedCustomerId,
        branchId: device.branchId,
        kind: 'CHARGE',
        amountMinor: creditAmount,
        reasonCode: 'SALE',
        referenceType: 'SALE',
        referenceId: saleId,
        referenceNumber: receiptNumber,
        occurredAt,
        idempotencyKey: `${context.clientTransactionId}:credit`,
        bypassPolicy: true,
        override:
          approval.valid && creditReason && !held
            ? { reasonCode: creditReason, note: proof?.note ?? null }
            : null,
      },
      undefined,
      approval.valid && approval.actor && !held ? { overrideActor: approval.actor } : {},
    )
  }

  // 9. Loyalty: the charged redemption is debited; earn is server-computed.
  let loyaltyEarnedPoints = 0
  if (resolvedCustomerId && redeemPoints > 0) {
    const currentQuote = await quoteRedeem(redeemPoints, executor)
    if (currentQuote.discountMinor !== loyaltyDiscountMinor) {
      pending.push({
        type: 'LOYALTY_RATE_CHANGED',
        severity: 'LOW',
        details: {
          kind: 'REDEEM',
          points: redeemPoints,
          chargedDiscountMinor: loyaltyDiscountMinor,
          currentDiscountMinor: currentQuote.discountMinor,
        },
      })
    }
    const redeemed = await postLoyaltyEntry(executor, actor, {
      customerId: resolvedCustomerId,
      branchId: device.branchId,
      kind: 'REDEEM',
      pointsDelta: -redeemPoints,
      referenceType: 'SALE',
      referenceId: saleId,
      referenceNumber: receiptNumber,
      occurredAt,
      idempotencyKey: `${context.clientTransactionId}:loyalty-redeem`,
      bypassBalanceCheck: true,
    })
    if (redeemed.account.balancePoints < 0) {
      pending.push({
        type: 'LOYALTY_NEGATIVE',
        severity: 'HIGH',
        details: {
          customerId: resolvedCustomerId,
          balancePoints: redeemed.account.balancePoints,
          redeemedPoints: redeemPoints,
        },
      })
    }
  }

  if (resolvedCustomerId && priced.baseMinor > 0) {
    const earned = await postLoyaltyEntry(executor, actor, {
      customerId: resolvedCustomerId,
      branchId: device.branchId,
      kind: 'EARN',
      netPaidMinor: priced.baseMinor,
      referenceType: 'SALE',
      referenceId: saleId,
      referenceNumber: receiptNumber,
      occurredAt,
      idempotencyKey: `${context.clientTransactionId}:loyalty-earn`,
      bypassBalanceCheck: true,
    })
    loyaltyEarnedPoints = earned.entry?.pointsDelta ?? 0
    if (payload.loyalty && loyaltyEarnedPoints !== payload.loyalty.earnPreviewPoints) {
      pending.push({
        type: 'LOYALTY_RATE_CHANGED',
        severity: 'LOW',
        details: {
          kind: 'EARN',
          previewPoints: payload.loyalty.earnPreviewPoints,
          earnedPoints: loyaltyEarnedPoints,
        },
      })
    }
  }

  // 10. Discount cap (D22/D23). The cap measures **all** discounts over gross —
  //     line discounts and the sale discount together — so a cashier cannot
  //     bypass it with a line-level discount. Within the cap is silent; above it
  //     needs a valid manager approval. The sale still applies either way.
  const totalDiscountMinor = priced.lineDiscountMinor + saleDiscountMinor
  if (totalDiscountMinor > 0) {
    const percent =
      priced.subtotalMinor > 0 ? Math.floor((totalDiscountMinor * 100) / priced.subtotalMinor) : 100
    const [cashierCap, managerCap] = await Promise.all([
      getSettingValue('pos.maxCashierDiscountPercent', {}, executor),
      getSettingValue('pos.maxManagerDiscountPercent', {}, executor),
    ])
    const capPercent =
      cashierRole === 'ADMIN' || cashierRole === 'MANAGER' ? managerCap : cashierCap
    // Compare in pesewas: at a 0% cap any discount is over, even one small
    // enough to floor to 0% of a large cart.
    const allowedDiscountMinor = Math.floor((priced.subtotalMinor * capPercent) / 100)

    if (totalDiscountMinor > allowedDiscountMinor) {
      const proof = payload.saleDiscount?.override
      const approval = await validateOverrideProof(executor, device, proof, 'pos.discount')
      if (approval.valid) {
        overrides.push({ kind: 'DISCOUNT', validation: approval, percent })
      } else {
        pending.push({
          type: 'OVERRIDE_INVALID',
          severity: 'HIGH',
          details: {
            kind: 'DISCOUNT',
            percent,
            capPercent,
            allowedDiscountMinor,
            totalDiscountMinor,
            grossMinor: priced.subtotalMinor,
            staffId: proof?.staffId ?? null,
            bindingId: proof?.bindingId ?? null,
            reasonCode: payload.saleDiscount?.reasonCode ?? null,
          },
        })
      }
    }
  }

  // 11. Clock skew: keep both facts, flag the difference.
  const skewMs = Math.abs(context.receivedAt.getTime() - occurredAt.getTime())
  if (skewMs > context.clockSkewToleranceMinutes * 60_000) {
    pending.push({
      type: 'CLOCK_SKEW',
      severity: 'LOW',
      details: {
        occurredAt: occurredAt.toISOString(),
        receivedAt: context.receivedAt.toISOString(),
        skewMinutes: Math.floor(skewMs / 60_000),
      },
    })
  }

  // 12. Sale rows with the charged money and computed split.
  await insertSale(
    {
      id: saleId,
      receiptNumber,
      branchId: device.branchId,
      terminalId: device.terminalId,
      deviceId: device.deviceId,
      shiftId: payload.shiftId,
      clientTransactionId: context.clientTransactionId,
      cashierUserId,
      cashierStaffId,
      customerId: resolvedCustomerId,
      occurredAt,
      receivedAt: context.receivedAt,
      subtotalMinor: header.subtotalMinor,
      lineDiscountMinor: header.lineDiscountMinor,
      saleDiscountMinor: header.saleDiscountMinor,
      loyaltyRedeemPoints: redeemPoints,
      loyaltyDiscountMinor: header.loyaltyDiscountMinor,
      vatMinor: header.vatMinor,
      nhilMinor: header.nhilMinor,
      getfundMinor: header.getfundMinor,
      taxTotalMinor: header.taxTotalMinor,
      totalMinor: header.totalMinor,
      tenderTotalMinor: cashTendered + creditAmount,
      changeMinor,
      loyaltyEarnedPoints,
      creditAmountMinor: creditAmount,
      taxMode,
      conflictCount: pending.length,
      appVersion: payload.appVersion ?? null,
    },
    executor,
  )

  await insertSaleLines(
    priced.lines.map((line, index) => {
      const item = catalog.byProductId.get(line.productId)
      return {
        saleId,
        productId: line.productId,
        lineNumber: index + 1,
        sku: item?.sku ?? '',
        name: item?.name ?? '',
        barcode: null,
        quantity: line.quantity,
        unitPriceMinor: line.unitPriceMinor,
        expectedUnitPriceMinor: item?.expectedUnitPriceMinor ?? line.unitPriceMinor,
        lineDiscountMinor: line.lineDiscountMinor,
        saleDiscountMinor: line.saleDiscountMinor,
        loyaltyDiscountMinor: line.loyaltyDiscountMinor,
        netMinor: line.netMinor,
        taxableMinor: line.taxableMinor,
        baseMinor: line.baseMinor,
        vatMinor: line.vatMinor,
        nhilMinor: line.nhilMinor,
        getfundMinor: line.getfundMinor,
        taxTotalMinor: line.taxTotalMinor,
        totalMinor: line.totalMinor,
        taxCategory: line.taxCategory,
        unitCostMinor: posted.levels.get(line.productId)?.avgCostMinor ?? 0,
        priceSource: item?.priceSource === 'BRANCH_OVERRIDE' ? 'OVERRIDE' : 'BASE',
      }
    }),
    executor,
  )

  await insertSaleTenders(
    payload.tenders.map((tender) => ({
      saleId,
      method: tender.method,
      amountMinor: tender.amountMinor,
      reference: null,
    })),
    executor,
  )

  // 13. Conflicts, then the audit trail.
  for (const conflict of pending) {
    const created = await addConflict(executor, { device, saleId }, conflict)
    applied.push(created)
    await writeAudit(
      {
        ...actor,
        action: 'pos.sale.conflict',
        entity: 'sync_conflict',
        entityId: created.id,
        after: {
          type: created.type,
          severity: created.severity,
          saleId,
          receiptNumber,
        },
        branchId: device.branchId,
        terminalId: device.terminalId,
      },
      executor,
    )
  }
  await updateSaleConflictCount(saleId, applied.length, executor)

  await writeAudit(
    {
      ...actor,
      action: 'pos.sale.applied',
      entity: 'sale',
      entityId: saleId,
      after: {
        receiptNumber,
        shiftId: payload.shiftId,
        customerId: resolvedCustomerId,
        totals: header,
        tenders: payload.tenders.map((tender) => ({
          method: tender.method,
          amountMinor: tender.amountMinor,
        })),
        loyalty: { redeemPoints, earnedPoints: loyaltyEarnedPoints },
        bindingValid,
        conflictTypes: applied.map((conflict) => conflict.type),
      },
      branchId: device.branchId,
      terminalId: device.terminalId,
    },
    executor,
  )

  for (const override of overrides) {
    if (!override.validation.actor) continue
    await writeAudit(
      {
        ...override.validation.actor,
        action: 'pos.sale.override',
        entity: 'sale',
        entityId: saleId,
        after: {
          kind: override.kind,
          reasonCode: override.validation.reasonCode,
          percent: override.percent ?? null,
          receiptNumber,
        },
        branchId: device.branchId,
        terminalId: device.terminalId,
      },
      executor,
    )
  }

  return { saleId, conflicts: applied, resolvedCustomerId }
}

// --- Variance review (Plan 12-08) -------------------------------------------

/** The reviewer's staff label; a user id is the fallback, never the PIN. */
function reviewerLabel(actor: AuditActor): string {
  return actor.actorStaffId ?? actor.actorId ?? 'unknown'
}

/**
 * The review's half of the decision registry (P12-D24, P12-D25).
 *
 * A variance is not a proposal, so `REJECTED` is refused: "rejected" would read
 * as "the money is fine now", which is a statement the reviewer cannot make. The
 * note is the outcome, and it is required for the same reason.
 *
 * `APPROVED` writes the four review columns and one audit row. No money column is
 * in the patch — `updateShiftReview` cannot even represent one — so the drawer's
 * figures are byte-identical after the decision (P12-D25).
 */
registerDecisionHandler('SHIFT_VARIANCE_REVIEW', async (tx, approval, actor, decision, input) => {
  if (decision !== 'APPROVED') {
    throw new ValidationError('A variance review records an outcome; it cannot be rejected')
  }

  const note = input.note?.trim() ?? ''
  if (note.length < 3) {
    throw new ValidationError('Record what you found before closing the review')
  }
  if (!approval.entityId) {
    throw new AppError(500, 'INTERNAL', 'A variance review has no shift')
  }

  const row = await findShiftByIdForUpdate(approval.entityId, tx)
  if (!row) throw new NotFoundError('Shift not found')
  if (row.status !== 'CLOSED') throw new ConflictError('This shift is not closed')
  if (row.reviewStatus !== 'REQUIRED') {
    throw new ConflictError('This shift is not awaiting review')
  }

  const reviewedAt = new Date()
  await updateShiftReview(
    row.id,
    {
      reviewStatus: 'REVIEWED',
      reviewedBy: reviewerLabel(actor),
      reviewedAt,
      reviewNote: note,
    },
    tx,
  )

  await writeAudit(
    {
      ...actor,
      action: 'pos.shift.reviewed',
      entity: 'shift',
      entityId: row.id,
      branchId: row.branchId,
      before: { reviewStatus: 'REQUIRED', varianceMinor: row.varianceMinor },
      after: {
        reviewStatus: 'REVIEWED',
        reviewNote: note,
        approvalId: approval.id,
        reviewedAt: reviewedAt.toISOString(),
      },
    },
    tx,
  )
})

/**
 * The review's half of the subject registry: the reviewer sees the drawer's
 * arithmetic — what the server expected, what the cashier counted, and the
 * terminal's name — so a wrong drawer reads differently from a terminal and
 * server that disagreed (SHIFT_VARIANCE_MISMATCH). Read-only, no transaction
 * (P12-D4). The close-time figures also travel in the approval payload.
 */
registerSubjectLoader('SHIFT_VARIANCE_REVIEW', async (approval) => {
  if (!approval.entityId) throw new NotFoundError('Shift not found')

  const found = await findShiftWithTerminal(approval.entityId)
  if (!found) throw new NotFoundError('Shift not found')

  const { shift: row } = found
  if (
    row.serverExpectedCashMinor === null ||
    row.countedCashMinor === null ||
    row.varianceMinor === null
  ) {
    // A review exists only for a closed shift; missing figures are an integrity
    // failure, not a shape the inbox should render as zeroes.
    throw new AppError(500, 'INTERNAL', 'This shift has no closed cash figures')
  }

  return {
    kind: 'shift_variance',
    shiftId: row.id,
    terminalName: found.terminalName,
    expectedMinor: row.serverExpectedCashMinor,
    countedMinor: row.countedCashMinor,
    varianceMinor: row.varianceMinor,
  }
})
