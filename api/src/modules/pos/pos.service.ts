import { randomBytes } from 'node:crypto'
import { type DbExecutor, db } from '@sceptre/db'
import {
  accraDayBounds,
  allocateProportionally,
  CART_VOID_REASONS,
  can,
  cartVoidNoteProblem,
  isElectronicTender,
  MAX_TENDERS_PER_SALE,
  movesStockBack,
  priceCart,
  refundAllocationProblem,
  refundApprovalRequired,
  refundableQuantity,
  type TaxMode,
  TENDER_PROBLEM_MESSAGES,
  tenderBalance,
} from '@sceptre/shared'
import { and, eq, inArray } from 'drizzle-orm'
import { hashPassword, verifyPassword } from '../../auth/password.ts'
import { resolveBranchFilter } from '../../auth/scope.ts'
import { AppError, ConflictError, NotFoundError, ValidationError } from '../../http/errors.ts'
import type { SessionUser } from '../../http/factory.ts'
import {
  registerDecisionHandler,
  registerSubjectLoader,
  requestApproval,
} from '../approvals/approvals.service.ts'
import { creditLedgerEntry } from '../credit/credit.schema.ts'
import { postEntryInTransaction as postCreditEntry } from '../credit/credit.service.ts'
import type { CreditOverrideReason } from '../credit/credit.types.ts'
import { resolveDraftCustomer } from '../customers/customers.service.ts'
import { postMovements } from '../inventory/inventory.service.ts'
import {
  postEntryInTransaction as postLoyaltyEntry,
  quoteRedeem,
} from '../loyalty/loyalty.service.ts'
import { hashDeviceToken } from '../org/enrollment.service.ts'
import { payment } from '../payments/payments.schema.ts'
import { writeAudit } from '../platform/audit.service.ts'
import type { AuditActor } from '../platform/audit.types.ts'
import { getSettingValue } from '../platform/settings.service.ts'
import type {
  CartVoidApplyResult,
  CartVoidPayload,
  CreditRepaymentPayload,
  DeviceAuthContext,
  DeviceStaffProof,
  RefundApplyResult,
  RefundPayload,
  RepaymentApplyResult,
} from '../sync/sync.types.ts'
import { addConflict } from './pos.conflicts.ts'
import { assessSaleTotals, loadSaleCatalog } from './pos.pricing.ts'
import {
  type ConflictFilters,
  countShiftReviewsAwaiting,
  countShiftSales,
  findActiveBinding,
  findBindingById,
  findBindingByTokenHash,
  findConflictRow,
  findCreditProfileRow,
  findOpenShiftByTerminal,
  findRefundById,
  findRefundByNumber,
  findSaleById,
  findSaleByIdForUpdate,
  findSaleByReceiptNumber,
  findShiftById,
  findShiftByIdForUpdate,
  findShiftReportByShiftId,
  findShiftWithTerminal,
  findStaffById,
  findStaffForAuthorization,
  findTerminalName,
  insertBinding,
  insertCashMovement,
  insertConflict,
  insertRefund,
  insertRefundLines,
  insertRefundTenders,
  insertSale,
  insertSaleLines,
  insertSaleTenders,
  insertShift,
  insertShiftReport,
  lockConflictForUpdate,
  lockTerminal,
  refundedLineTotals,
  revokeBinding,
  revokeStaffBindings,
  selectConflictRows,
  selectConflictScope,
  selectRefundedLines,
  selectRefundedTenderAmounts,
  selectRefundedTotalForSale,
  selectRefundLineEvidence,
  selectRefundLines,
  selectRefundTenders,
  selectSaleLinesForRefund,
  selectSaleTendersForRefund,
  selectShiftCashTotals,
  selectShiftReportFigures,
  selectSoldValueByProduct,
  touchBinding,
  updateConflictResolution,
  updateRefundApprovalId,
  updateSaleConflictCount,
  updateShiftClose,
  updateShiftReview,
  updateStaffPinHash,
} from './pos.repository.ts'
import { cartVoid, saleTender } from './pos.schema.ts'
import type {
  AppliedConflict,
  BindingStaff,
  BindingValidationResult,
  CashMovementPayload,
  ConflictDetail,
  ConflictList,
  ConflictResolutionInput,
  ConflictRow,
  ConflictSubject,
  DeviceStaffRecord,
  OverrideProof,
  SaleApplyResult,
  SaleContext,
  SalePayload,
  ShiftApplyResult,
  ShiftCashTotals,
  ShiftClosePayload,
  ShiftOpenPayload,
  ShiftReportScope,
  ShiftReportView,
  ShiftVarianceSubject,
  StaffBindingResult,
  SyncConflictSeverity,
  SyncConflictType,
} from './pos.types.ts'
import type { ConflictListQuery } from './pos.validation.ts'

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

/**
 * Expected cash = float + cash tenders − change + cash in − cash out − cash
 * refunds, in the order the money moved: the float and the tenders arrived, the
 * change and the settled cash refunds left, and the manual in/out movements are
 * the drawer's corrections.
 *
 * The refund term is not optional bookkeeping: a settled cash refund is money
 * the drawer has already given back, so omitting it expects cash that is gone.
 * Card and MoMo refunds are absent by construction — they never touched the
 * notes (`selectShiftCashTotals` filters `CASH`/`SETTLED`).
 */
export function computeExpectedCash(totals: ShiftCashTotals): number {
  return (
    totals.openingFloatMinor +
    totals.cashTendersMinor -
    totals.changeMinor +
    totals.cashInMinor -
    totals.cashOutMinor -
    totals.cashRefundsMinor +
    totals.cashRepaymentsMinor
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
 * `SHIFT_CLOSE` gained an optional closer (P13-D41). Declared beside the close
 * path because that is its only reader; the field is additive, so a Phase 6 till
 * that sends no `closedBy` still closes.
 */
export interface ShiftCloseWithCloser extends ShiftClosePayload {
  closedBy?: DeviceStaffProof | null
}

/**
 * Closes a shift with the server's own expected cash. The client's expected
 * value is stored beside it; a difference raises a reconciliation conflict but
 * never blocks the close.
 */
export async function closeShift(
  device: DeviceAuthContext,
  payload: ShiftCloseWithCloser,
  executor: DbExecutor = db,
): Promise<ShiftApplyResult> {
  const row = await findShiftByIdForUpdate(payload.shiftId, executor)
  if (!row) throw new AppError(404, 'SHIFT_NOT_FOUND', 'Shift not found')
  assertShiftMatchesDevice(row, device)
  if (row.status !== 'OPEN') {
    throw new ConflictError('The shift is already closed')
  }

  // Who closed the drawer, when the till says (P13-D41). A binding from another
  // device is refused before anything is written, so the shift stays open and
  // the till can re-authorize rather than close under the wrong name.
  let closer: DeviceStaffRecord | null = null
  if (payload.closedBy) {
    const resolved = await findBindingByTokenHash(
      hashDeviceToken(payload.closedBy.bindingToken),
      executor,
    )
    const live =
      resolved !== null &&
      resolved.binding.id === payload.closedBy.bindingId &&
      resolved.staff.userId === payload.closedBy.userId &&
      resolved.staff.staffId === payload.closedBy.staffId &&
      resolved.staff.pinVersion === payload.closedBy.pinVersion &&
      bindingIsLive(device, resolved.binding, resolved.staff)
    if (!resolved || !live) {
      throw new AppError(
        403,
        'STALE_CREDENTIALS',
        'The staff closing this shift is not authorized on this device',
      )
    }
    closer = resolved.staff
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
          cashRepaymentsMinor: totals.cashRepaymentsMinor,
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
      // The name against the drawer: the person who counted it, whoever that is.
      closedBy: closer?.staffId ?? row.cashierStaffId,
    },
    executor,
  )

  // The Z-report is written in the same transaction as the close (P13-D32): a
  // closed shift without its snapshot would be a drawer whose report has to be
  // guessed at, and a rollback takes both facts away together.
  const figures = await selectShiftReportFigures(payload.shiftId, executor)
  await insertShiftReport(
    {
      shiftId: row.id,
      branchId: row.branchId,
      terminalId: row.terminalId,
      deviceId: row.deviceId,
      number: row.number,
      openedAt: row.openedAt,
      closedAt,
      openingFloatMinor: row.openingFloatMinor,
      saleCount: figures.saleCount,
      itemCount: figures.itemCount,
      refundCount: figures.refundCount,
      voidCount: figures.voidCount,
      grossMinor: figures.grossMinor,
      refundMinor: figures.refundedMinor,
      netMinor: figures.grossMinor - figures.refundedMinor,
      lineDiscountMinor: figures.lineDiscountMinor,
      saleDiscountMinor: figures.saleDiscountMinor,
      loyaltyDiscountMinor: figures.loyaltyDiscountMinor,
      loyaltyRedeemPoints: figures.loyaltyRedeemPoints,
      loyaltyEarnedPoints: figures.loyaltyEarnedPoints,
      baseMinor: figures.baseMinor,
      vatMinor: figures.vatMinor,
      nhilMinor: figures.nhilMinor,
      getfundMinor: figures.getfundMinor,
      taxTotalMinor: figures.taxTotalMinor,
      cashMinor: figures.cashMinor,
      creditMinor: figures.creditMinor,
      momoMinor: figures.momoMinor,
      cardMinor: figures.cardMinor,
      bankTransferMinor: figures.bankTransferMinor,
      changeMinor: figures.changeMinor,
      cashInMinor: totals.cashInMinor,
      cashOutMinor: totals.cashOutMinor,
      // The cash the drawer lost to refunds, stored with the expected cash it is
      // already subtracted from: one selector, one figure, no second predicate
      // that can drift from the drawer arithmetic.
      cashRefundMinor: totals.cashRefundsMinor,
      // The cash that came in against credit, stored beside the expected cash it
      // is already added to: one selector, one figure (P20-D1).
      cashRepaymentMinor: totals.cashRepaymentsMinor,
      expectedCashMinor: serverExpected,
      countedCashMinor: payload.countedCashMinor,
      varianceMinor: variance,
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

    // The requester is whoever closed the drawer (P13-D41). When the till named
    // them, that is a real staff member and the no-self-approval rule can bite;
    // when it did not, the fallback is the shift's cashier, exactly as Phase 12
    // behaved, and the payload says so rather than letting a reviewer guess.
    const requester = closer
      ? auditActorFor(closer)
      : auditActorFor({ userId: row.cashierUserId, staffId: row.cashierStaffId })

    await requestApproval(
      requester,
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
          closed_by: closer?.staffId ?? 'shift owner (unattributed)',
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
      actorId: closer?.userId ?? row.cashierUserId,
      actorStaffId: closer?.staffId ?? row.cashierStaffId,
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

// --- X and Z reports (Plan 13-07) -------------------------------------------

/**
 * **The one shift-report arithmetic, behind two gates** (P14-D12).
 *
 * A device and a session must not be able to read two different drawers, so there
 * is exactly one function that assembles an X or a Z: `closeShift` writes the
 * snapshot with the same `selectShiftReportFigures` + `selectShiftCashTotals`, and
 * both callers below only decide who may ask.
 *
 * - `Z` is the stored snapshot and **refuses to rebuild** when it is missing
 *   (`SHIFT_REPORT_MISSING`, 500). A report that can be reconstructed on read is a
 *   report that can change after the customer has gone home (P13-D32).
 * - `X` computes the same figures live and writes nothing (P13-D33). Asking for an
 *   X of a closed shift returns the live figures with `closedAt` set, which is a
 *   legitimate reading of a drawer.
 *
 * Not theirs is indistinguishable from not there: a terminal may not read another
 * terminal's shift (P13-D39, A01). A session's 403 is decided by its own caller
 * before it gets here, because a 404 for a manager ASKING for another branch would
 * hide a fact they are entitled to know exists.
 */
export async function readShiftReport(
  scope: ShiftReportScope,
  shiftId: string,
  kind: 'X' | 'Z',
): Promise<ShiftReportView> {
  const row = await findShiftById(shiftId)
  const outOfScope =
    !row ||
    (scope.terminalId !== undefined && row.terminalId !== scope.terminalId) ||
    (scope.branchId !== null && row.branchId !== scope.branchId)
  if (!row || outOfScope) throw new NotFoundError('Shift not found')

  if (kind === 'Z') {
    if (row.status !== 'CLOSED') {
      throw new AppError(409, 'SHIFT_NOT_CLOSED', 'An X-report is the one for an open shift')
    }

    const snapshot = await findShiftReportByShiftId(shiftId)
    if (!snapshot) {
      throw new AppError(
        500,
        'SHIFT_REPORT_MISSING',
        'This shift closed without its Z-report; the snapshot cannot be rebuilt',
      )
    }

    return {
      kind: 'Z',
      shiftId: snapshot.shiftId,
      number: snapshot.number,
      branchId: snapshot.branchId,
      terminalId: snapshot.terminalId,
      deviceId: snapshot.deviceId,
      openedAt: snapshot.openedAt.toISOString(),
      closedAt: snapshot.closedAt.toISOString(),
      openingFloatMinor: snapshot.openingFloatMinor,
      saleCount: snapshot.saleCount,
      itemCount: snapshot.itemCount,
      refundCount: snapshot.refundCount,
      voidCount: snapshot.voidCount,
      grossMinor: snapshot.grossMinor,
      refundMinor: snapshot.refundMinor,
      netMinor: snapshot.netMinor,
      lineDiscountMinor: snapshot.lineDiscountMinor,
      saleDiscountMinor: snapshot.saleDiscountMinor,
      loyaltyDiscountMinor: snapshot.loyaltyDiscountMinor,
      loyaltyRedeemPoints: snapshot.loyaltyRedeemPoints,
      loyaltyEarnedPoints: snapshot.loyaltyEarnedPoints,
      baseMinor: snapshot.baseMinor,
      vatMinor: snapshot.vatMinor,
      nhilMinor: snapshot.nhilMinor,
      getfundMinor: snapshot.getfundMinor,
      taxTotalMinor: snapshot.taxTotalMinor,
      cashMinor: snapshot.cashMinor,
      creditMinor: snapshot.creditMinor,
      momoMinor: snapshot.momoMinor,
      cardMinor: snapshot.cardMinor,
      bankTransferMinor: snapshot.bankTransferMinor,
      changeMinor: snapshot.changeMinor,
      cashInMinor: snapshot.cashInMinor,
      cashOutMinor: snapshot.cashOutMinor,
      // The snapshot's own figure: null for a report written before Phase 14
      // measured it, so a legacy Z says "not itemised" rather than inventing one.
      cashRefundMinor: snapshot.cashRefundMinor,
      // The snapshot's own figure, null for a Z written before repayments were
      // attributed to a drawer (P20-D1).
      cashRepaymentMinor: snapshot.cashRepaymentMinor,
      expectedCashMinor: snapshot.expectedCashMinor,
      countedCashMinor: snapshot.countedCashMinor,
      varianceMinor: snapshot.varianceMinor,
      // The moment the report was taken, which for a snapshot is its own creation.
      generatedAt: snapshot.createdAt.toISOString(),
    }
  }

  const [totals, figures] = await Promise.all([
    selectShiftCashTotals(shiftId, row.openingFloatMinor),
    selectShiftReportFigures(shiftId),
  ])

  const expectedCashMinor = computeExpectedCash(totals)
  const closed = row.status === 'CLOSED'
  const countedCashMinor = closed ? row.countedCashMinor : null

  return {
    kind: 'X',
    shiftId: row.id,
    number: row.number,
    branchId: row.branchId,
    terminalId: row.terminalId,
    deviceId: row.deviceId,
    openedAt: row.openedAt.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null,
    openingFloatMinor: row.openingFloatMinor,
    saleCount: figures.saleCount,
    itemCount: figures.itemCount,
    refundCount: figures.refundCount,
    voidCount: figures.voidCount,
    grossMinor: figures.grossMinor,
    refundMinor: figures.refundedMinor,
    netMinor: figures.grossMinor - figures.refundedMinor,
    lineDiscountMinor: figures.lineDiscountMinor,
    saleDiscountMinor: figures.saleDiscountMinor,
    loyaltyDiscountMinor: figures.loyaltyDiscountMinor,
    loyaltyRedeemPoints: figures.loyaltyRedeemPoints,
    loyaltyEarnedPoints: figures.loyaltyEarnedPoints,
    baseMinor: figures.baseMinor,
    vatMinor: figures.vatMinor,
    nhilMinor: figures.nhilMinor,
    getfundMinor: figures.getfundMinor,
    taxTotalMinor: figures.taxTotalMinor,
    cashMinor: figures.cashMinor,
    creditMinor: figures.creditMinor,
    momoMinor: figures.momoMinor,
    cardMinor: figures.cardMinor,
    bankTransferMinor: figures.bankTransferMinor,
    changeMinor: figures.changeMinor,
    cashInMinor: totals.cashInMinor,
    cashOutMinor: totals.cashOutMinor,
    // The live drawer, measured by the same selector the close uses.
    cashRefundMinor: totals.cashRefundsMinor,
    cashRepaymentMinor: totals.cashRepaymentsMinor,
    expectedCashMinor,
    countedCashMinor,
    varianceMinor: countedCashMinor === null ? null : countedCashMinor - expectedCashMinor,
    generatedAt: new Date().toISOString(),
  }
}

/**
 * The Z-report for a terminal's own shift (Plan 13-07). The device gate is the
 * extraction's first caller: the shift must belong to the calling device's
 * terminal *and* branch, and is otherwise not found.
 */
export async function getZReport(
  device: DeviceAuthContext,
  shiftId: string,
): Promise<ShiftReportView> {
  return readShiftReport({ branchId: device.branchId, terminalId: device.terminalId }, shiftId, 'Z')
}

/** The X-report for a terminal's own shift; the same arithmetic, asked live. */
export async function getXReport(
  device: DeviceAuthContext,
  shiftId: string,
): Promise<ShiftReportView> {
  return readShiftReport({ branchId: device.branchId, terminalId: device.terminalId }, shiftId, 'X')
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
  /** Set when the conflict is about a shift the sale names (a closed drawer). */
  shiftId?: string | null
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

/**
 * What one sold unit cost (17-03).
 *
 * The branch's weighted average is the truth when it exists. A product received
 * somewhere else in the company has a known purchase price and no branch level
 * yet, and selling it at zero would report a 100% margin on goods that were
 * paid for — so the last receipt cost stands in until the branch receives it.
 * Zero only remains when nobody has ever bought the product.
 *
 * The figure stays derived from receipts; P11-D13's rule (one writable cost) is
 * untouched.
 */
function costForSale(branchAverageMinor: number, productCostMinor: number): number {
  if (Number.isSafeInteger(branchAverageMinor) && branchAverageMinor > 0) return branchAverageMinor
  if (Number.isSafeInteger(productCostMinor) && productCostMinor > 0) return productCostMinor
  return 0
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
  permission: 'pos.discount' | 'credit.override' | 'pos.refund',
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

/** The facts a sale tender needs from a payment, and nothing more (P13-D15). */
interface TenderPayment {
  id: string
  branchId: string
  terminalId: string
  shiftId: string
  method: 'MOMO' | 'CARD' | 'BANK_TRANSFER'
  status: 'PENDING' | 'PAID' | 'FAILED' | 'ABANDONED' | 'EXPIRED'
  amountMinor: number
  providerReference: string
  referenced: boolean
}

/**
 * Loads every electronic tender's payment in one statement (P13-D6).
 *
 * `FOR SHARE` holds the rows for the rest of the upload transaction, and a
 * second statement says whether an earlier sale already spent one of them. The
 * provider reference is read from here, never from the payload: a terminal may
 * not choose what the receipt prints.
 */
async function loadTenderPayments(
  paymentIds: string[],
  executor: DbExecutor,
): Promise<Map<string, TenderPayment>> {
  if (paymentIds.length === 0) return new Map()

  const [rows, spent] = await Promise.all([
    executor
      .select({
        id: payment.id,
        branchId: payment.branchId,
        terminalId: payment.terminalId,
        shiftId: payment.shiftId,
        method: payment.method,
        status: payment.status,
        amountMinor: payment.amountMinor,
        providerReference: payment.providerReference,
      })
      .from(payment)
      .where(inArray(payment.id, paymentIds))
      .for('share'),
    executor
      .select({ paymentId: saleTender.paymentId })
      .from(saleTender)
      .where(inArray(saleTender.paymentId, paymentIds)),
  ])

  const referenced = new Set(spent.map((row) => row.paymentId))
  return new Map(rows.map((row) => [row.id, { ...row, referenced: referenced.has(row.id) }]))
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

  // 1. Shift: the sale belongs to a shift this terminal owned. A shift that has
  //    already closed is not a reason to lose the sale (SYNC-05: conflicts are
  //    information, never a rejection): a till finishes its shift before its
  //    queue drains, so the sale is applied and flagged for a manager instead.
  //    A sale that claims to have happened *after* the draw closed cannot belong
  //    to that shift and is still refused.
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
  let appliedAfterClose: Date | null = null
  if (shiftRow.status === 'CLOSED' && shiftRow.closedAt) {
    if (occurredAt.getTime() > shiftRow.closedAt.getTime()) {
      throw saleRejected(
        'SHIFT_CLOSED',
        'The sale is dated after its shift closed, so it does not belong to that drawer',
      )
    }
    appliedAfterClose = shiftRow.closedAt
  } else if (shiftRow.status !== 'OPEN') {
    throw saleRejected('SHIFT_CLOSED', 'The sale references a shift that is not open')
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
  // A shop that is not VAT-registered charges no VAT, NHIL or GETFund, whatever
  // the catalogue says. Read here, in the same place the tax mode is read, so the
  // server's arithmetic and the till's cannot disagree.
  const vatRegistered = await getSettingValue('pricing.vatRegistered', {}, executor)
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
    { taxMode, vatRegistered, saleDiscountMinor, loyaltyDiscountMinor },
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

  // 6. Tender integrity (P13-D1, D3, D5, D6). Every check below runs before a
  //    single row is written, so a client defect leaves nothing to reconcile.
  const totalMinor = header.totalMinor
  if (!Number.isSafeInteger(totalMinor) || totalMinor < 0) {
    // `priceCart` already guarantees this; the guard keeps the shared arithmetic
    // from throwing a RangeError on a value a future caller might pass.
    throw saleRejected('INVALID_TOTALS', 'The sale total must be non-negative whole pesewas')
  }

  // 6a. Shape: the wire schema says the same, and a direct service call is not
  //     allowed to be less careful than the wire.
  if (payload.tenders.length > MAX_TENDERS_PER_SALE) {
    throw saleRejected('INVALID_TENDER', TENDER_PROBLEM_MESSAGES.TOO_MANY_TENDERS)
  }
  for (const tender of payload.tenders) {
    if (!Number.isSafeInteger(tender.amountMinor) || tender.amountMinor < 0) {
      throw saleRejected('INVALID_TENDER', 'Tender amounts must be non-negative whole pesewas')
    }
    if (!isElectronicTender(tender.method) && tender.paymentId) {
      throw saleRejected('INVALID_TENDER', 'Cash and credit tenders carry no payment')
    }
  }
  if (totalMinor > 0 && payload.tenders.length === 0) {
    throw saleRejected('INVALID_TENDER', 'A sale with a balance due needs at least one payment')
  }
  if (totalMinor === 0 && payload.tenders.length > 0) {
    throw saleRejected('INVALID_TENDER', 'A sale with nothing to pay carries no payment')
  }

  // 6b. Arithmetic through the one shared implementation (P13-D3). A problem is
  //     an impossible tender set, not a business conflict: the sale is refused.
  const tenders = payload.tenders.map((tender, index) => ({
    method: tender.method,
    amountMinor: tender.amountMinor,
    sequence: index + 1,
  }))
  const balance = tenderBalance(totalMinor, tenders)
  if (balance.problem) {
    throw saleRejected('INVALID_TENDER', TENDER_PROBLEM_MESSAGES[balance.problem], {
      problem: balance.problem,
    })
  }

  // 6c. The change is the server's number; a till that declares another is
  //     claiming money that never left the drawer.
  const changeMinor = balance.changeMinor
  if (changeMinor !== payload.totals.changeMinor) {
    throw saleRejected('INVALID_TENDER', 'The change does not match the tendered amount', {
      chargedChangeMinor: payload.totals.changeMinor,
      computedChangeMinor: changeMinor,
    })
  }

  // 6c-i. The drawer this sale belongs to was already closed and its stored
  //       expected cash was computed without this sale. The sale still applies
  //       (money that was taken must exist), and a manager sees exactly how much
  //       the closed drawer is short by. Nothing here rewrites the closed shift:
  //       its Z is a snapshot of what the server knew at the close.
  if (appliedAfterClose) {
    const cashTenderedMinor = payload.tenders
      .filter((tender) => tender.method === 'CASH')
      .reduce((sum, tender) => sum + tender.amountMinor, 0)
    pending.push({
      type: 'SALE_AFTER_SHIFT_CLOSE',
      severity: 'HIGH',
      // The manager reviews the drawer, so the conflict names the shift as well
      // as the sale.
      shiftId: payload.shiftId,
      details: {
        shiftClosedAt: appliedAfterClose.toISOString(),
        saleOccurredAt: occurredAt.toISOString(),
        lagMinutes: Math.max(
          0,
          Math.round((appliedAfterClose.getTime() - occurredAt.getTime()) / 60_000),
        ),
        saleTotalMinor: totalMinor,
        cashTenderedMinor,
        changeMinor,
      },
    })
  }

  // 6d. Credit is one tender (6b guarantees it), needs a customer, and the
  //     portion — not the sale total — is what reaches the ledger (P13-D4).
  const creditTender = payload.tenders.find((tender) => tender.method === 'CREDIT')
  const creditAmount = creditTender?.amountMinor ?? 0
  if (creditAmount > 0 && !resolvedCustomerId) {
    throw saleRejected('CREDIT_REQUIRES_CUSTOMER', 'A credit sale needs a customer')
  }

  // 6e. Electronic money only counts when the server itself settled a payment
  //     of exactly this size, on this terminal, in this shift, once (P13-D6).
  const paymentReferenceById = new Map<string, string>()
  const electronicTenders = payload.tenders.filter((tender) => isElectronicTender(tender.method))
  if (electronicTenders.length > 0) {
    const paymentIds: string[] = []
    for (const tender of electronicTenders) {
      if (!tender.paymentId) {
        throw saleRejected('INVALID_TENDER', 'An electronic payment needs the payment it settled')
      }
      paymentIds.push(tender.paymentId)
    }
    if (new Set(paymentIds).size !== paymentIds.length) {
      // The partial unique index would refuse the second row, but as a 500 on
      // the upload rather than a message the till can act on. One payment, one
      // tender, always (P13-D6).
      throw saleRejected('INVALID_TENDER', 'The same payment cannot settle two tenders')
    }

    const payments = await loadTenderPayments(paymentIds, executor)
    for (const tender of electronicTenders) {
      const paymentRow = payments.get(tender.paymentId ?? '')
      if (!paymentRow) {
        throw saleRejected('INVALID_TENDER', 'The payment this tender cites no longer exists')
      }
      if (paymentRow.terminalId !== device.terminalId || paymentRow.branchId !== device.branchId) {
        throw saleRejected('INVALID_TENDER', 'This payment belongs to another terminal')
      }
      if (paymentRow.shiftId !== payload.shiftId) {
        throw saleRejected('INVALID_TENDER', 'This payment was taken on another shift')
      }
      if (paymentRow.status !== 'PAID') {
        throw saleRejected('INVALID_TENDER', 'This payment has not settled yet')
      }
      if (paymentRow.amountMinor !== tender.amountMinor) {
        throw saleRejected('INVALID_TENDER', 'The payment amount does not match this tender')
      }
      if (paymentRow.method !== tender.method) {
        // The tender's method is what the receipt prints and what the provider
        // reconciliation groups by, so it must be the channel that took the
        // money, not merely a channel.
        throw saleRejected(
          'INVALID_TENDER',
          `The payment was taken by ${paymentRow.method}, not ${tender.method}`,
        )
      }
      if (paymentRow.referenced) {
        throw saleRejected('INVALID_TENDER', 'This payment has already been used on another sale')
      }
      paymentReferenceById.set(paymentRow.id, paymentRow.providerReference)
    }
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

  // 11. Clock skew: keep both facts, flag the difference. A sale that arrived
  //     after its shift closed is not a clock problem — the queue is why it is
  //     old, and `SALE_AFTER_SHIFT_CLOSE` already carries the lag. Reporting
  //     both would make one incident look like two.
  const skewMs = Math.abs(context.receivedAt.getTime() - occurredAt.getTime())
  if (!appliedAfterClose && skewMs > context.clockSkewToleranceMinutes * 60_000) {
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
      tenderTotalMinor: balance.appliedMinor,
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
        unitCostMinor: costForSale(
          posted.levels.get(line.productId)?.avgCostMinor ?? 0,
          item?.costPriceMinor ?? 0,
        ),
        priceSource: item?.priceSource === 'BRANCH_OVERRIDE' ? 'OVERRIDE' : 'BASE',
      }
    }),
    executor,
  )

  await insertSaleTenders(
    payload.tenders.map((tender, index) => ({
      saleId,
      sequence: index + 1,
      method: tender.method,
      amountMinor: tender.amountMinor,
      paymentId: tender.paymentId ?? null,
      // The display copy of the provider reference comes from the payment row
      // validated above, never from the payload (P13-D6).
      reference: tender.paymentId ? (paymentReferenceById.get(tender.paymentId) ?? null) : null,
    })),
    executor,
  )

  // 13. Conflicts, then the audit trail.
  for (const conflict of pending) {
    const created = await addConflict(
      executor,
      { device, saleId, shiftId: conflict.shiftId ?? null },
      conflict,
    )
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

// --- Refund application (Plan 05) -------------------------------------------

type RefundComponent =
  | 'baseMinor'
  | 'vatMinor'
  | 'nhilMinor'
  | 'getfundMinor'
  | 'taxTotalMinor'
  | 'totalMinor'

const REFUND_COMPONENTS: readonly RefundComponent[] = [
  'baseMinor',
  'vatMinor',
  'nhilMinor',
  'getfundMinor',
  'taxTotalMinor',
  'totalMinor',
]

function refundRejected(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): AppError {
  // 409: a refund cap is a business refusal, not a malformed request. The upload
  // dispatcher stores it as REJECTED so the till learns the code and moves on.
  return new AppError(409, code, message, details)
}

function refundInvalid(message: string): AppError {
  return new AppError(400, 'REFUND_INVALID', message)
}

/** A readable amount for a refusal message. Money stays integer pesewas. */
function formatRefundMinor(minor: number): string {
  return `GHS ${Math.trunc(minor / 100)}.${String(minor % 100).padStart(2, '0')}`
}

/**
 * The rules a single document can be checked against without reading the sale.
 * The wire schema says the same; a direct service call is not allowed to be
 * less careful than the wire (the same discipline `assertSaleShape` keeps).
 */
function assertRefundShape(payload: RefundPayload): void {
  if (!payload.number?.trim() || payload.number.length > 64) {
    throw refundInvalid('A refund needs a valid number')
  }
  if (payload.lines.length === 0 || payload.lines.length > 200) {
    throw refundInvalid('A refund needs between 1 and 200 lines')
  }

  const seen = new Set<string>()
  for (const line of payload.lines) {
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > 10_000) {
      throw refundInvalid('Refund quantities must be between 1 and 10,000')
    }
    if (seen.has(line.saleLineId)) {
      // Two rows for one sale line would make the restock choice ambiguous and
      // the per-line cap a sum of two documents. One line, one decision.
      throw refundInvalid('A sale line may appear only once on a refund')
    }
    seen.add(line.saleLineId)

    if (line.restock === 'DAMAGED') {
      if (!line.damageReason || line.damageReason.trim().length < 3) {
        throw refundInvalid('A damaged line needs a damage reason of at least 3 characters')
      }
    } else if (line.damageReason) {
      throw refundInvalid('Only a damaged line carries a damage reason')
    }
  }

  if (payload.tenders.length === 0 || payload.tenders.length > MAX_TENDERS_PER_SALE) {
    throw refundInvalid(`A refund needs between 1 and ${MAX_TENDERS_PER_SALE} tender allocations`)
  }
  for (const tender of payload.tenders) {
    if (!Number.isSafeInteger(tender.amountMinor) || tender.amountMinor < 1) {
      throw refundInvalid('A refund tender allocation must be a positive whole amount')
    }
  }
  if (!Number.isSafeInteger(payload.refundedMinor) || payload.refundedMinor < 1) {
    throw refundInvalid('A refund must return a positive whole amount')
  }
}

/** Which refusal a shared allocation problem becomes on the wire. */
function refundProblemError(problem: string): AppError {
  switch (problem) {
    case 'EXCEEDS_LINE':
      return refundRejected('REFUND_EXCEEDS_LINE', 'That is more than is left of this line')
    case 'EXCEEDS_TENDER':
      return refundRejected('REFUND_EXCEEDS_TENDER', 'That is more than this tender holds')
    case 'EXCEEDS_SALE':
      return refundRejected('REFUND_EXCEEDS_SALE', 'That is more than this sale kept')
    case 'SUM_MISMATCH':
      return refundRejected(
        'REFUND_SUM_MISMATCH',
        'The tender allocations must add up to the refunded amount',
      )
    default:
      return refundInvalid('A refund needs at least one line and one tender allocation')
  }
}

/**
 * Applies one refund in the caller's transaction, under a lock on the sale.
 *
 * A refund is a new document (P13-D17): the sale, its lines and its tenders are
 * read and never written. The caps are re-derived here rather than trusted from
 * the till, because the till may have been offline for a day and the same sale
 * may have been refunded at another till since (P13-D19).
 */
export async function applyRefund(
  context: SaleContext,
  payload: RefundPayload,
  executor: DbExecutor = db,
): Promise<RefundApplyResult> {
  assertRefundShape(payload)

  const device = context.device
  const refundId = context.clientTransactionId
  const number = payload.number.trim()
  const occurredAt = parseOccurredAt(payload.occurredAt)

  // 1. Lock the sale first: two tills refunding one sale serialise here, before
  //    either reads a cap (P13-D19).
  const saleRow = await findSaleByIdForUpdate(payload.saleId, executor)
  if (!saleRow) {
    throw new AppError(404, 'REFUND_SALE_MISSING', 'The sale this refund names does not exist')
  }
  if (saleRow.branchId !== device.branchId || saleRow.terminalId !== device.terminalId) {
    // P13-D25: a sale is refundable at the terminal that took it. The console's
    // cross-terminal path is a later phase, not a quiet widening of this one.
    throw new AppError(
      403,
      'REFUND_SALE_FOREIGN',
      'A sale is refundable only at the terminal that recorded it',
    )
  }

  // The refund's own shift is where the money left the drawer; the sale's shift
  // may already be closed, which is why the sale's shift is not compared.
  const refundShift = await findShiftByIdForUpdate(payload.shiftId, executor)
  if (!refundShift) {
    throw refundInvalid('The refund references a shift that does not exist')
  }
  if (refundShift.branchId !== device.branchId || refundShift.terminalId !== device.terminalId) {
    throw new AppError(
      409,
      'SHIFT_DEVICE_MISMATCH',
      'The refund shift does not belong to this terminal',
    )
  }

  // Idempotency at the service seam: a replay that got past the reservation
  // ledger must not write a second document.
  const existingNumber = await findRefundByNumber(number, executor)
  if (existingNumber) {
    if (existingNumber.id === refundId) {
      const stored = await findRefundById(refundId, executor)
      if (stored) {
        return {
          refundId: stored.id,
          number: stored.number,
          refundedMinor: stored.refundedMinor,
          pendingDispatch: [],
        }
      }
    }
    throw refundRejected('REFUND_NUMBER_CONFLICT', 'This refund number is already used')
  }

  // 2. Authorise: the manager PIN is the authority, and the approver may not be
  //    the person handing the money back (P13-D24).
  const approval = await validateOverrideProof(executor, device, payload.approval, 'pos.refund')
  if (!approval.valid || !approval.actor) {
    throw new AppError(403, 'OVERRIDE_INVALID', 'A refund needs a live manager approval')
  }

  const resolvedCashier = await findBindingByTokenHash(
    hashDeviceToken(payload.cashier.bindingToken),
    executor,
  )
  const cashier =
    resolvedCashier &&
    resolvedCashier.binding.id === payload.cashier.bindingId &&
    resolvedCashier.staff.userId === payload.cashier.userId &&
    resolvedCashier.staff.pinVersion === payload.cashier.pinVersion &&
    bindingIsLive(device, resolvedCashier.binding, resolvedCashier.staff)
      ? { userId: resolvedCashier.staff.userId, staffId: resolvedCashier.staff.staffId }
      : { userId: payload.cashier.userId, staffId: payload.cashier.staffId }

  if (payload.approval.userId === cashier.userId || payload.approval.staffId === cashier.staffId) {
    throw new AppError(403, 'OVERRIDE_INVALID', 'A cashier cannot authorise their own refund')
  }
  const actor = auditActorFor(cashier)
  const approver = approval.actor

  // 3-5. Caps, from the sale and the refunds already booked against it.
  const [saleLines, saleTenders, refundedLines, refundedTenders, alreadyRefundedMinor] =
    await Promise.all([
      selectSaleLinesForRefund(saleRow.id, executor),
      selectSaleTendersForRefund(saleRow.id, executor),
      selectRefundedLines(saleRow.id, executor),
      selectRefundedTenderAmounts(saleRow.id, executor),
      selectRefundedTotalForSale(saleRow.id, executor),
    ])

  const saleLinesById = new Map(saleLines.map((line) => [line.id, line]))
  const saleTendersById = new Map(saleTenders.map((tender) => [tender.id, tender]))

  for (const line of payload.lines) {
    if (!saleLinesById.has(line.saleLineId)) {
      throw refundInvalid('A refund line names a sale line that is not on this sale')
    }
  }
  for (const tender of payload.tenders) {
    if (!saleTendersById.has(tender.saleTenderId)) {
      throw refundInvalid('A refund tender names a tender that is not on this sale')
    }
  }

  // The sale cap is checked first so the till gets the headline number: change
  // was never money we kept, so it is not refundable (P13-D19). The shared
  // allocation helper keeps the same check as its second line of defence.
  const keptMinor = saleRow.tenderTotalMinor - saleRow.changeMinor
  if (alreadyRefundedMinor + payload.refundedMinor > keptMinor) {
    throw refundProblemError('EXCEEDS_SALE')
  }

  const problem = refundAllocationProblem({
    allocation: {
      lines: payload.lines.map((line) => ({
        saleLineId: line.saleLineId,
        quantity: line.quantity,
      })),
      tenders: payload.tenders.map((tender) => ({
        saleTenderId: tender.saleTenderId,
        amountMinor: tender.amountMinor,
      })),
    },
    lines: saleLines.map((line) => ({
      saleLineId: line.id,
      quantity: line.quantity,
      refundedQuantity: refundedLineTotals(refundedLines, line.id).quantity,
    })),
    tenders: saleTenders.map((tender) => ({
      saleTenderId: tender.id,
      method: tender.method,
      amountMinor: tender.amountMinor,
      refundedMinor: refundedTenders.get(tender.id) ?? 0,
    })),
    refundedMinor: payload.refundedMinor,
    saleTenderTotalMinor: saleRow.tenderTotalMinor,
    saleChangeMinor: saleRow.changeMinor,
    previouslyRefundedMinor: alreadyRefundedMinor,
  })
  if (problem) throw refundProblemError(problem)

  // 6. Money per line. Each component is allocated over the quantity *still*
  //    unrefunded, so the last refund of a line takes that line's exact
  //    remainder and the components of every refund sum to the line's own
  //    figures (P13-D17). Allocating over the original quantity would not
  //    telescope: 1 of 3 then 2 of 3 would not add up to the line.
  const pricedLines = payload.lines.map((line) => {
    const saleLine = saleLinesById.get(line.saleLineId) as (typeof saleLines)[number]
    const already = refundedLineTotals(refundedLines, saleLine.id)
    const remainingQuantity = refundableQuantity({
      saleLineId: saleLine.id,
      quantity: saleLine.quantity,
      refundedQuantity: already.quantity,
    })
    const weights = [line.quantity, remainingQuantity - line.quantity]

    const components = {} as Record<RefundComponent, number>
    for (const component of REFUND_COMPONENTS) {
      // The caps above make a negative remainder impossible; clamping keeps a
      // drifted row from throwing a RangeError mid-transaction.
      const remaining = Math.max(0, saleLine[component] - already[component])
      components[component] = allocateProportionally(remaining, weights)[0] ?? 0
    }

    return {
      saleLineId: saleLine.id,
      productId: saleLine.productId,
      quantity: line.quantity,
      unitPriceMinor: saleLine.unitPriceMinor,
      // The cost the goods were sold at, not today's average (P13-D22).
      unitCostMinor: saleLine.unitCostMinor,
      restock: line.restock,
      damageReason: line.restock === 'DAMAGED' ? (line.damageReason?.trim() ?? null) : null,
      ...components,
    }
  })

  const header = REFUND_COMPONENTS.reduce(
    (totals, component) => {
      totals[component] = pricedLines.reduce((sum, line) => sum + line[component], 0)
      return totals
    },
    {} as Record<RefundComponent, number>,
  )

  // What the shop gives back must equal what came back, restocked or not
  // (P13-D17, P13-D19). Without this the header's tax reversal can exceed the
  // money that actually left, and the Z-report's VAT would be wrong by the
  // difference. Checked before a row is written, like every other cap.
  if (header.totalMinor !== payload.refundedMinor) {
    throw refundRejected(
      'REFUND_LINE_TOTAL_MISMATCH',
      `The refunded amount (${formatRefundMinor(payload.refundedMinor)}) does not match the value of the lines returned (${formatRefundMinor(header.totalMinor)})`,
      { refundedMinor: payload.refundedMinor, lineTotalMinor: header.totalMinor },
    )
  }

  // 7. The document.
  const created = await insertRefund(
    {
      id: refundId,
      number,
      saleId: saleRow.id,
      branchId: device.branchId,
      terminalId: device.terminalId,
      deviceId: device.deviceId,
      shiftId: payload.shiftId,
      customerId: saleRow.customerId,
      reasonCode: payload.reasonCode,
      note: payload.note?.trim() || null,
      refundedMinor: payload.refundedMinor,
      ...header,
      approvedByUserId: approver.actorId ?? payload.approval.userId,
      approvedByStaffId: approver.actorStaffId ?? payload.approval.staffId,
      approvalPinVersion: payload.approval.pinVersion,
      approvalReasonCode: payload.approval.reasonCode,
      approvedAt: parseOccurredAt(payload.approval.occurredAt),
      occurredAt,
      receivedAt: context.receivedAt,
    },
    executor,
  )

  // 8. The lines.
  await insertRefundLines(
    pricedLines.map((line, index) => ({
      refundId: created.id,
      saleLineId: line.saleLineId,
      productId: line.productId,
      lineNumber: index + 1,
      quantity: line.quantity,
      unitPriceMinor: line.unitPriceMinor,
      unitCostMinor: line.unitCostMinor,
      restock: line.restock,
      damageReason: line.damageReason,
      baseMinor: line.baseMinor,
      vatMinor: line.vatMinor,
      nhilMinor: line.nhilMinor,
      getfundMinor: line.getfundMinor,
      taxTotalMinor: line.taxTotalMinor,
      totalMinor: line.totalMinor,
    })),
    executor,
  )

  // 9. The tenders. Cash and credit settle now; electronic money waits for the
  //    provider, because only Paystack can move it (P13-D26).
  const settledAt = new Date()
  await insertRefundTenders(
    payload.tenders.map((tender, index) => {
      const saleTenderRow = saleTendersById.get(tender.saleTenderId) as (typeof saleTenders)[number]
      const electronic = isElectronicTender(saleTenderRow.method)
      if (electronic && !saleTenderRow.paymentId) {
        throw refundRejected(
          'REFUND_TENDER_UNPAID',
          'An electronic tender has no payment to refund against',
        )
      }
      return {
        refundId: created.id,
        sequence: index + 1,
        method: saleTenderRow.method,
        amountMinor: tender.amountMinor,
        saleTenderId: saleTenderRow.id,
        paymentId: saleTenderRow.paymentId,
        status: electronic ? ('PENDING' as const) : ('SETTLED' as const),
        settledAt: electronic ? null : settledAt,
      }
    }),
    executor,
  )
  const refundTenderRows = await selectRefundTenders(created.id, executor)

  // 10. Stock: only resalable goods come back. A damaged or unreturned unit
  //     never left sellable stock, so posting anything would decrement twice
  //     or invent a unit (P13-D22).
  const stockByProduct = new Map<string, { quantity: number; unitCostMinor: number }>()
  for (const line of pricedLines) {
    if (!movesStockBack(line.restock)) continue
    const entry = stockByProduct.get(line.productId) ?? {
      quantity: 0,
      unitCostMinor: line.unitCostMinor,
    }
    entry.quantity += line.quantity
    stockByProduct.set(line.productId, entry)
  }
  if (stockByProduct.size > 0) {
    await postMovements(
      actor,
      [...stockByProduct.entries()].map(([productId, entry]) => ({
        productId,
        branchId: device.branchId,
        type: 'RETURN' as const,
        quantityDelta: entry.quantity,
        unitCostMinor: entry.unitCostMinor,
        referenceType: 'REFUND' as const,
        referenceId: created.id,
        referenceNumber: created.number,
        note: `Return on receipt ${saleRow.receiptNumber}`,
      })),
      { executor },
    )
  }

  // 11. Credit: refunding a credit tender shrinks the debt and pays no cash
  //     (P13-D20). The customer never handed that money over.
  const creditMinor = refundTenderRows
    .filter((tender) => tender.method === 'CREDIT')
    .reduce((sum, tender) => sum + tender.amountMinor, 0)
  if (creditMinor > 0) {
    if (!saleRow.customerId) {
      // A credit tender always had a customer; a sale without one is corruption,
      // and inventing a ledger row against nobody would be worse.
      throw new AppError(500, 'INTERNAL', 'A credit refund has no customer to credit')
    }
    await postCreditEntry(
      executor,
      actor,
      null,
      {
        customerId: saleRow.customerId,
        branchId: device.branchId,
        kind: 'REFUND',
        amountMinor: -creditMinor,
        reasonCode: 'RETURN',
        referenceType: 'REFUND',
        referenceId: created.id,
        referenceNumber: created.number,
        occurredAt,
        idempotencyKey: `${created.id}:credit`,
      },
      undefined,
    )
  }

  // 12. The retrospective approval (P13-D21, P13-D23). It is raised here, on the
  //     server, whenever the upload arrives — an offline refund therefore raises
  //     it at sync time, and the till is never blocked or told.
  const threshold = await getSettingValue(
    'pos.refundApprovalThresholdMinor',
    { branchId: device.branchId },
    executor,
  )
  let approvalId: string | null = null
  if (refundApprovalRequired(created.refundedMinor, threshold)) {
    const raised = await requestApproval(
      actor,
      {
        type: 'REFUND',
        entityId: created.id,
        branchId: device.branchId,
        amountMinor: created.refundedMinor,
        note: created.note,
        deciderRole: 'ADMIN',
        deciderBranchId: null,
        payload: {
          refundId: created.id,
          number: created.number,
          saleId: saleRow.id,
          receiptNumber: saleRow.receiptNumber,
          refundedMinor: created.refundedMinor,
          reasonCode: created.reasonCode,
          lineCount: pricedLines.length,
          cashTendersMinor: refundTenderRows
            .filter((tender) => tender.method === 'CASH')
            .reduce((sum, tender) => sum + tender.amountMinor, 0),
          creditMinor,
          electronicMinor: refundTenderRows
            .filter((tender) => isElectronicTender(tender.method))
            .reduce((sum, tender) => sum + tender.amountMinor, 0),
          approvedBy: approver.actorStaffId ?? null,
        },
      },
      executor,
    )
    approvalId = raised.id
    await updateRefundApprovalId(created.id, raised.id, executor)
  }

  // 13. Audit: the figures before and after, the approver, and the raise.
  await writeAudit(
    {
      ...actor,
      action: 'pos.refund.applied',
      entity: 'refund',
      entityId: created.id,
      branchId: device.branchId,
      terminalId: device.terminalId,
      before: {
        saleTotalMinor: saleRow.totalMinor,
        refundedMinorBefore: alreadyRefundedMinor,
      },
      after: {
        number: created.number,
        saleId: saleRow.id,
        receiptNumber: saleRow.receiptNumber,
        refundedMinor: created.refundedMinor,
        refundedMinorAfter: alreadyRefundedMinor + created.refundedMinor,
        reasonCode: created.reasonCode,
        tenders: refundTenderRows.map((tender) => ({
          method: tender.method,
          amountMinor: tender.amountMinor,
          status: tender.status,
        })),
        restock: pricedLines.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          restock: line.restock,
        })),
        approvalId,
      },
    },
    executor,
  )

  await writeAudit(
    {
      ...approver,
      action: 'pos.refund.override',
      entity: 'refund',
      entityId: created.id,
      branchId: device.branchId,
      terminalId: device.terminalId,
      after: {
        number: created.number,
        reasonCode: payload.approval.reasonCode,
        note: payload.approval.note ?? null,
        pinVersion: payload.approval.pinVersion,
        refundedMinor: created.refundedMinor,
      },
    },
    executor,
  )

  if (approvalId) {
    await writeAudit(
      {
        ...actor,
        action: 'pos.refund.approval_raised',
        entity: 'refund',
        entityId: created.id,
        branchId: device.branchId,
        terminalId: device.terminalId,
        after: {
          approvalId,
          refundedMinor: created.refundedMinor,
          thresholdMinor: threshold,
        },
      },
      executor,
    )
  }

  return {
    refundId: created.id,
    number: created.number,
    refundedMinor: created.refundedMinor,
    pendingDispatch: refundTenderRows
      .filter((tender) => tender.status === 'PENDING' && tender.paymentId)
      .map((tender) => ({
        refundTenderId: tender.id,
        saleTenderId: tender.saleTenderId,
        paymentId: tender.paymentId as string,
        amountMinor: tender.amountMinor,
      })),
  }
}

// --- Device repayment and cart void (Plan 06) --------------------------------

function repaymentInvalid(message: string): AppError {
  return new AppError(400, 'REPAYMENT_INVALID', message)
}

/**
 * Shape rules the wire schema also enforces. A direct service call is not
 * allowed to be less careful than the wire (`assertSaleShape` keeps the same
 * discipline), and the cash/MoMo distinction is what stops a payment being
 * counted twice (P13-D27).
 */
function assertRepaymentShape(payload: CreditRepaymentPayload): void {
  if (
    !Number.isSafeInteger(payload.amountMinor) ||
    payload.amountMinor < 1 ||
    payload.amountMinor > 1_000_000_000
  ) {
    throw repaymentInvalid('A repayment must be a positive whole amount')
  }
  if (!payload.number || !/^[A-Za-z0-9-]+$/.test(payload.number) || payload.number.length > 64) {
    throw repaymentInvalid('A repayment needs a valid number')
  }
  if (payload.note && payload.note.length > 200) {
    throw repaymentInvalid('A repayment note may be at most 200 characters')
  }
  if (payload.method === 'MOMO' && !payload.paymentId) {
    throw repaymentInvalid('A MoMo repayment needs the payment it settled')
  }
  if (payload.method !== 'MOMO' && payload.paymentId) {
    throw repaymentInvalid('A cash repayment carries no payment')
  }
}

interface RepaymentPaymentRow {
  id: string
  branchId: string
  terminalId: string
  shiftId: string
  method: 'MOMO' | 'CARD' | 'BANK_TRANSFER'
  status: 'PENDING' | 'PAID' | 'FAILED' | 'ABANDONED' | 'EXPIRED'
  amountMinor: number
}

/**
 * Loads and locks the payment a MoMo repayment claims, then proves it is the
 * money this repayment is for and that nothing else has spent it.
 *
 * The row is locked rather than read: the reuse checks below and the ledger row
 * they authorise must not interleave with a second repayment of the same money.
 */
async function lockRepaymentPayment(
  executor: DbExecutor,
  device: DeviceAuthContext,
  paymentId: string,
  shiftId: string,
  amountMinor: number,
): Promise<RepaymentPaymentRow> {
  const rows = await executor
    .select({
      id: payment.id,
      branchId: payment.branchId,
      terminalId: payment.terminalId,
      shiftId: payment.shiftId,
      method: payment.method,
      status: payment.status,
      amountMinor: payment.amountMinor,
    })
    .from(payment)
    .where(eq(payment.id, paymentId))
    .for('update')
  const row = rows[0]
  if (!row) {
    throw saleRejected('INVALID_TENDER', 'The payment this repayment cites no longer exists')
  }
  if (row.terminalId !== device.terminalId || row.branchId !== device.branchId) {
    throw saleRejected('INVALID_TENDER', 'This payment belongs to another terminal')
  }
  if (row.shiftId !== shiftId) {
    throw saleRejected('INVALID_TENDER', 'This payment was taken on another shift')
  }
  if (row.status !== 'PAID') {
    throw saleRejected('INVALID_TENDER', 'This payment has not settled yet')
  }
  if (row.amountMinor !== amountMinor) {
    throw saleRejected('INVALID_TENDER', 'The payment amount does not match this repayment')
  }
  if (row.method !== 'MOMO') {
    throw saleRejected('INVALID_TENDER', `The payment was taken by ${row.method}, not MoMo`)
  }

  // One payment settles one fact: a repayment of the debt or a tender on a sale,
  // never both. The first query is the repayment ledger; the second is the sale
  // this terminal already took with the same money.
  const [spentOnRepayment, spentOnSale] = await Promise.all([
    executor
      .select({ id: creditLedgerEntry.id })
      .from(creditLedgerEntry)
      .where(
        and(
          eq(creditLedgerEntry.referenceType, 'POS_REPAYMENT'),
          eq(creditLedgerEntry.referenceId, paymentId),
        ),
      )
      .limit(1),
    executor
      .select({ id: saleTender.id })
      .from(saleTender)
      .where(eq(saleTender.paymentId, paymentId))
      .limit(1),
  ])
  if (spentOnRepayment.length > 0 || spentOnSale.length > 0) {
    throw saleRejected('INVALID_TENDER', 'This payment has already been used')
  }

  return row
}

/**
 * Applies one credit repayment in the caller's transaction (P13-D27).
 *
 * No PIN for cash: paying a debt down cannot create credit, and a repayment that
 * needed a manager would be money the shop never records. The one exception is a
 * profile on hold, where taking money is exactly how a hold gets bypassed.
 */
export async function applyRepayment(
  context: SaleContext,
  payload: CreditRepaymentPayload,
  executor: DbExecutor = db,
): Promise<RepaymentApplyResult> {
  assertRepaymentShape(payload)

  const device = context.device
  const occurredAt = parseOccurredAt(payload.occurredAt)

  // 1. The shift the money belongs to.
  const shiftRow = await findShiftByIdForUpdate(payload.shiftId, executor)
  if (!shiftRow) throw new AppError(404, 'SHIFT_NOT_FOUND', 'Shift not found')
  assertShiftMatchesDevice(shiftRow, device)
  if (shiftRow.status !== 'OPEN') {
    throw saleRejected('SHIFT_CLOSED', 'The repayment references a closed shift')
  }

  const profile = await findCreditProfileRow(payload.customerId, device.branchId, executor)

  // 2. Electronic money: the server must already have settled it.
  if (payload.method === 'MOMO' && payload.paymentId) {
    await lockRepaymentPayment(
      executor,
      device,
      payload.paymentId,
      payload.shiftId,
      payload.amountMinor,
    )
  }

  // 3. A held account needs a manager, and a cashier binding is not one. The
  //    hold is read here (not inside the posting path) so the refusal can name
  //    it instead of surfacing as a generic credit error.
  let overrideActor: AuditActor | null = null
  if (profile?.hold) {
    if (!payload.override) {
      throw new AppError(
        409,
        'REPAYMENT_ON_HOLD',
        'Credit is on hold for this customer; a manager must approve a repayment',
        { customerId: payload.customerId, branchId: device.branchId },
      )
    }
    const approval = await validateOverrideProof(
      executor,
      device,
      payload.override,
      'credit.override',
    )
    if (!approval.valid || !approval.actor) {
      throw new AppError(
        403,
        'OVERRIDE_INVALID',
        'A repayment against a held account needs a live manager approval',
      )
    }
    overrideActor = approval.actor
  }

  const actor = auditActorFor({ userId: payload.cashier.userId, staffId: payload.cashier.staffId })

  // 4. The ledger row. `reference_id` is the fact this may only be posted once:
  //    the paid payment for MoMo, the upload for cash. The upload's own
  //    idempotency key carries a replay.
  const posted = await postCreditEntry(
    executor,
    actor,
    null,
    {
      customerId: payload.customerId,
      branchId: device.branchId,
      kind: 'REPAYMENT',
      amountMinor: -payload.amountMinor,
      method: payload.method,
      note: payload.note?.trim() || null,
      referenceType: 'POS_REPAYMENT',
      referenceId: payload.paymentId ?? context.clientTransactionId,
      referenceNumber: payload.number,
      // The drawer the cash went into (P20-D1). The till already proved the shift
      // is open and belongs to this terminal, so the ledger can name it and the
      // close's expected cash can add the money back.
      shiftId: payload.shiftId,
      occurredAt,
      idempotencyKey: `${context.clientTransactionId}:repayment`,
    },
    undefined,
  )

  // 5. Audit: the figures either side of the movement, so the till's number and
  //    the ledger's can be reconciled without replaying the table.
  await writeAudit(
    {
      ...actor,
      action: 'pos.repayment.received',
      entity: 'credit_ledger_entry',
      entityId: posted.entry.id,
      branchId: device.branchId,
      terminalId: device.terminalId,
      before: { balanceMinor: profile?.balanceMinor ?? 0 },
      after: {
        customerId: payload.customerId,
        number: payload.number,
        amountMinor: payload.amountMinor,
        method: payload.method,
        paymentId: payload.paymentId ?? null,
        balanceMinor: posted.profile.balanceMinor,
      },
    },
    executor,
  )

  if (overrideActor && payload.override) {
    await writeAudit(
      {
        ...overrideActor,
        action: 'pos.repayment.override',
        entity: 'credit_ledger_entry',
        entityId: posted.entry.id,
        branchId: device.branchId,
        terminalId: device.terminalId,
        after: {
          reasonCode: payload.override.reasonCode,
          note: payload.override.note ?? null,
          amountMinor: payload.amountMinor,
          pinVersion: payload.override.pinVersion,
        },
      },
      executor,
    )
  }

  return {
    repaymentId: context.clientTransactionId,
    entryId: posted.entry.id,
    balanceAfterMinor: posted.profile.balanceMinor,
  }
}

function cartVoidRejected(code: string, message: string): AppError {
  return new AppError(400, code, message)
}

/**
 * Records an abandoned cart in the caller's transaction (P13-D28).
 *
 * A voided cart never became a sale, so nothing else moves: no stock, no credit,
 * no loyalty. The row exists so the reason reaches the server even when the
 * customer simply walked out, which is how a shrink report becomes possible.
 */
export async function applyCartVoid(
  context: SaleContext,
  payload: CartVoidPayload,
  executor: DbExecutor = db,
): Promise<CartVoidApplyResult> {
  const device = context.device
  const occurredAt = parseOccurredAt(payload.occurredAt)

  const shiftRow = await findShiftByIdForUpdate(payload.shiftId, executor)
  if (!shiftRow) throw new AppError(404, 'SHIFT_NOT_FOUND', 'Shift not found')
  assertShiftMatchesDevice(shiftRow, device)
  if (shiftRow.status !== 'OPEN') {
    throw cartVoidRejected('SHIFT_CLOSED', 'The cart void references a closed shift')
  }

  const note = payload.note?.trim() || null
  if (!CART_VOID_REASONS.includes(payload.reasonCode)) {
    // The wire's enum stops this; a direct caller would otherwise meet a pg
    // enum error, which reads as a server fault on a client defect.
    throw cartVoidRejected('CART_VOID_INVALID', 'Unknown cart void reason')
  }
  const problem = cartVoidNoteProblem(payload.reasonCode, note)
  if (problem) throw cartVoidRejected('CART_VOID_NOTE_REQUIRED', problem)

  if (!Number.isSafeInteger(payload.itemCount) || payload.itemCount < 0) {
    throw cartVoidRejected('CART_VOID_INVALID', 'A cart void needs a whole item count')
  }
  if (!Number.isSafeInteger(payload.grossMinor) || payload.grossMinor < 0) {
    throw cartVoidRejected('CART_VOID_INVALID', 'A cart void needs a whole gross amount')
  }
  if (payload.lines.length > 200) {
    throw cartVoidRejected('CART_VOID_INVALID', 'A cart void carries at most 200 lines')
  }

  const actor = auditActorFor({ userId: payload.cashier.userId, staffId: payload.cashier.staffId })

  // The primary key is the idempotency key: a replay keeps the first row, and
  // the audit row is written only by the delivery that inserted it.
  const inserted = await executor
    .insert(cartVoid)
    .values({
      id: context.clientTransactionId,
      branchId: device.branchId,
      terminalId: device.terminalId,
      deviceId: device.deviceId,
      shiftId: payload.shiftId,
      cashierUserId: payload.cashier.userId,
      cashierStaffId: payload.cashier.staffId,
      reasonCode: payload.reasonCode,
      note,
      itemCount: payload.itemCount,
      grossMinor: payload.grossMinor,
      label: payload.label?.trim() || null,
      lines: payload.lines,
      occurredAt,
      receivedAt: context.receivedAt,
    })
    .onConflictDoNothing({ target: cartVoid.id })
    .returning({ id: cartVoid.id })

  if (inserted.length > 0) {
    await writeAudit(
      {
        ...actor,
        action: 'pos.cart.voided',
        entity: 'cart_void',
        entityId: context.clientTransactionId,
        branchId: device.branchId,
        terminalId: device.terminalId,
        after: {
          reasonCode: payload.reasonCode,
          note,
          itemCount: payload.itemCount,
          grossMinor: payload.grossMinor,
          label: payload.label?.trim() || null,
        },
      },
      executor,
    )
  }

  return { cartVoidId: context.clientTransactionId }
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
 * Closed shifts in the branch whose variance is waiting for a reviewer.
 *
 * The manager's operations view (Plan 12-10) needs this number and no list
 * service owned it, so it lives with the shifts it counts. Branch scoping runs
 * through `resolveBranchFilter` even though the route already demanded
 * `approval.read`: a manager asking for another branch is a 403 here too
 * (P11-D17), and the caller cannot obtain a foreign queue by editing a query
 * string. Read-only — no transaction, no writes, no money column.
 */
export async function countShiftsAwaitingReview(
  user: SessionUser,
  requestedBranchId?: string | null,
): Promise<{ count: number; branchId: string | null }> {
  const branchId = resolveBranchFilter(user, requestedBranchId ?? null)
  return { count: await countShiftReviewsAwaiting(branchId), branchId }
}

/**
 * The close-time extras the review payload carries. The shift row and the live
 * staff/sales reads stay authoritative; this is the fallback for display facts
 * that can outlive their row (a cashier renamed or removed after the close).
 */
function shiftVarianceFallbacks(payload: unknown): {
  cashierName?: string | null
  closedAt?: string
  saleCount?: number
  clientExpectedMinor?: number
} {
  if (typeof payload !== 'object' || payload === null) return {}
  const record = payload as Record<string, unknown>
  return {
    ...(typeof record.cashierName === 'string' || record.cashierName === null
      ? { cashierName: record.cashierName }
      : {}),
    ...(typeof record.closedAt === 'string' ? { closedAt: record.closedAt } : {}),
    ...(typeof record.saleCount === 'number' && Number.isSafeInteger(record.saleCount)
      ? { saleCount: record.saleCount }
      : {}),
    ...(typeof record.clientExpectedMinor === 'number' &&
    Number.isSafeInteger(record.clientExpectedMinor)
      ? { clientExpectedMinor: record.clientExpectedMinor }
      : {}),
  }
}

/**
 * The review's half of the subject registry: the reviewer sees the drawer's
 * arithmetic — what the server expected, what the cashier counted, and the
 * terminal's name — so a wrong drawer reads differently from a terminal and
 * server that disagreed (SHIFT_VARIANCE_MISMATCH). The close-time facts the
 * payload carries (shift number, cashier, the open/close window, sale count, and
 * the till's own expected cash) are returned on the subject too, so the console
 * never reaches into `approval.payload`. Read-only, no transaction (P12-D4).
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

  const [cashier, liveSaleCount] = await Promise.all([
    findStaffById(row.cashierUserId),
    countShiftSales(row.id),
  ])
  const fallback = shiftVarianceFallbacks(approval.payload)
  const closedAt = row.closedAt?.toISOString() ?? fallback.closedAt
  if (!closedAt) {
    throw new AppError(500, 'INTERNAL', 'This shift has no closed cash figures')
  }

  const subject: ShiftVarianceSubject = {
    kind: 'shift_variance',
    shiftId: row.id,
    terminalName: found.terminalName,
    expectedMinor: row.serverExpectedCashMinor,
    countedMinor: row.countedCashMinor,
    varianceMinor: row.varianceMinor,
    shiftNumber: row.number,
    cashierName: cashier?.name ?? fallback.cashierName ?? null,
    openedAt: row.openedAt.toISOString(),
    closedAt,
    // Sales are append-only, so the live count is the truth; the close-time
    // snapshot is only a fallback for an explicitly zero live read.
    saleCount: liveSaleCount > 0 ? liveSaleCount : (fallback.saleCount ?? 0),
    clientExpectedMinor: row.clientExpectedCashMinor ?? fallback.clientExpectedMinor ?? 0,
  }
  return subject
})

/**
 * The refund's half of the decision registry (P13-D21, P13-D23).
 *
 * The money has already gone back by the time an admin reads this: cash left the
 * drawer at the till, and the electronic portion is with the provider. A decision
 * is therefore a judgement recorded after the fact, and this handler writes
 * **only** an audit row. It has no writer for a refund money column — the patch
 * types in `pos.repository.ts` do not even represent one — so a decided refund
 * is byte-identical afterwards (Plan 05 §3).
 */
registerDecisionHandler('REFUND', async (tx, approval, actor, decision, input) => {
  if (!approval.entityId) {
    throw new AppError(500, 'INTERNAL', 'A refund approval has no refund')
  }
  if (decision === 'REJECTED' && !input.reasonCode) {
    throw new ValidationError('A rejection needs a reason code')
  }

  const row = await findRefundById(approval.entityId, tx)
  if (!row) throw new NotFoundError('Refund not found')

  await writeAudit(
    {
      ...actor,
      action: 'pos.refund.reviewed',
      entity: 'refund',
      entityId: row.id,
      branchId: row.branchId,
      terminalId: row.terminalId,
      after: {
        decision,
        reasonCode: input.reasonCode ?? null,
        note: input.note?.trim() || null,
        refundedMinor: row.refundedMinor,
      },
    },
    tx,
  )
})

/**
 * The refund's half of the subject registry. The reviewer sees the document as
 * the customer would: the receipt it unwinds, what came back, how much of it can
 * be resold, and how the money was returned. Read-only, no transaction.
 */
registerSubjectLoader('REFUND', async (approval) => {
  if (!approval.entityId) throw new NotFoundError('Refund not found')

  const row = await findRefundById(approval.entityId)
  if (!row) throw new NotFoundError('Refund not found')

  const [lines, tenders, saleRow, lineEvidence] = await Promise.all([
    selectRefundLines(row.id),
    selectRefundTenders(row.id),
    findSaleById(row.saleId),
    selectRefundLineEvidence(row.id),
  ])

  return {
    kind: 'refund',
    refundId: row.id,
    number: row.number,
    saleId: row.saleId,
    receiptNumber: saleRow?.receiptNumber ?? '',
    refundedMinor: row.refundedMinor,
    reasonCode: row.reasonCode,
    lineCount: lines.length,
    itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
    // Counted in lines, not units: each line is one restock decision.
    restock: {
      resalable: lines.filter((line) => line.restock === 'RESALABLE').length,
      damaged: lines.filter((line) => line.restock === 'DAMAGED').length,
      notReturned: lines.filter((line) => line.restock === 'NOT_RETURNED').length,
    },
    // The evidence behind the counts: one row per refunded line, in line order,
    // carrying the sale line's snapshot name and the damage reason (P13-D22).
    lines: lineEvidence,
    tenders: tenders.map((tender) => ({
      method: tender.method,
      amountMinor: tender.amountMinor,
      status: tender.status,
    })),
    approvedBy: row.approvedByStaffId,
    occurredAt: row.occurredAt.toISOString(),
    originalTotalMinor: saleRow?.totalMinor ?? row.refundedMinor,
  }
})

/**
 * Ex-tax base sold per product for a branch in a half-open window. Empty map
 * when nothing sold.
 *
 * A read service-to-service seam with no authorisation: the caller has already
 * resolved the branch (`counts.service.recomputeAbcClasses` runs under an
 * admin-only route or the nightly job). Money stays integer minor units —
 * `base_minor` is the ex-tax base, not the tax-inclusive `net_minor`.
 */
export async function sumSoldValueByProduct(
  branchId: string,
  from: Date,
  to: Date,
  executor: DbExecutor = db,
): Promise<Map<string, number>> {
  return selectSoldValueByProduct(branchId, from, to, executor)
}

// --- The conflict queue and the act of resolving one (Phase 14, Plan 04) -----
//
// A conflict is a record of something that was applied at the till and flagged.
// Reading the queue is an oversight read; resolving one is a **record**, not a
// repair (P14-D13): it writes five columns on `sync_conflict` and one audit row,
// and it touches no sale, refund, shift, movement or ledger. A correction is a new
// document in the module that owns it.
//
// Authority is `resolveBranchFilter` in both directions — the list's branch and
// the row's own branch — so a manager is pinned to their branch and a foreign id
// is a 403 rather than a 404 that hides existence (P14-D7, OWASP A01).

/** `from`/`to` are inclusive Accra days; SQL gets a half-open window. */
function conflictDayWindow(
  from?: string,
  to?: string,
): { from: Date | null; toExclusive: Date | null } {
  const fromDate = from ? new Date(accraDayBounds(new Date(`${from}T00:00:00.000Z`)).from) : null
  const toExclusive = to ? new Date(accraDayBounds(new Date(`${to}T00:00:00.000Z`)).to) : null

  if (fromDate && toExclusive && fromDate.getTime() >= toExclusive.getTime()) {
    throw new ValidationError('from must be on or before to')
  }
  return { from: fromDate, toExclusive }
}

function conflictFiltersFor(user: SessionUser, query: ConflictListQuery): ConflictFilters {
  const window = conflictDayWindow(query.from, query.to)
  return {
    branchId: resolveBranchFilter(user, query.branchId ?? null),
    // `ALL` is the absence of a status filter, not a fourth status.
    status: query.status === 'ALL' ? null : query.status,
    type: query.type ?? null,
    severity: query.severity ?? null,
    saleId: query.saleId ?? null,
    shiftId: query.shiftId ?? null,
    terminalId: query.terminalId ?? null,
    from: window.from,
    toExclusive: window.toExclusive,
    limit: query.limit,
    offset: query.offset,
  }
}

/**
 * The document a conflict points at, as a reference rather than a copy: the
 * reviewer clicks through to the oversight screen that owns the detail
 * (`/api/pos/oversight/sales/:id`, `/shifts/:id`).
 *
 * A rejected upload has no sale — `details.clientTransactionId` is its only link
 * — and `none` says so instead of inventing a document (Plan 04 §1).
 */
async function loadConflictSubject(
  row: ConflictRow,
  executor: DbExecutor = db,
): Promise<ConflictSubject> {
  if (row.saleId) {
    const saleRow = await findSaleById(row.saleId, executor)
    if (saleRow) {
      return {
        kind: 'sale',
        id: saleRow.id,
        receiptNumber: saleRow.receiptNumber,
        occurredAt: saleRow.occurredAt.toISOString(),
        totalMinor: saleRow.totalMinor,
        conflictCount: saleRow.conflictCount,
      }
    }
  }

  if (row.shiftId) {
    const shiftRow = await findShiftById(row.shiftId, executor)
    if (shiftRow) {
      return {
        kind: 'shift',
        id: shiftRow.id,
        number: shiftRow.number,
        openedAt: shiftRow.openedAt.toISOString(),
        closedAt: shiftRow.closedAt?.toISOString() ?? null,
        varianceMinor: shiftRow.varianceMinor,
      }
    }
  }

  return { kind: 'none' }
}

/**
 * The queue: `OPEN` by default, HIGH before LOW, oldest first inside a severity.
 * Paged and filtered in SQL, never in memory — a list that reads every conflict in
 * a branch to render twenty is a list that gets slower with the shop's worst year.
 */
export async function listConflicts(
  user: SessionUser,
  query: ConflictListQuery,
): Promise<ConflictList> {
  const result = await selectConflictRows(conflictFiltersFor(user, query))
  return {
    conflicts: result.rows,
    total: result.total,
    limit: query.limit,
    offset: query.offset,
  }
}

/** One conflict plus the document it is about. */
export async function getConflict(user: SessionUser, conflictId: string): Promise<ConflictDetail> {
  const row = await findConflictRow(conflictId)
  if (!row) throw new NotFoundError('Conflict not found')
  // The row's own branch, not the caller's request: a manager may learn that
  // another branch's conflict exists, never read it.
  resolveBranchFilter(user, row.branchId)

  return { ...row, subject: await loadConflictSubject(row) }
}

/**
 * Resolve one conflict, or dismiss it with a reason.
 *
 * The order is the contract:
 *
 * 1. the row's branch against `resolveBranchFilter` — a foreign branch is a 403;
 * 2. `SELECT … FOR UPDATE`, so two managers pressing the same button serialise;
 * 3. refuse unless `OPEN` — a 409, because the second press is normal, not an
 *    error worth a 400 and certainly not a second audit row;
 * 4. write the five resolution columns;
 * 5. append exactly one audit row, `pos.conflict.resolved`, with the before and
 *    the after.
 *
 * Nothing else is written. There is deliberately no "resolve and retry": a
 * resolution is a judgement, and if the judgement is that the fact was wrong, the
 * correction is a new document.
 */
export async function resolveConflict(
  user: SessionUser,
  actor: AuditActor,
  conflictId: string,
  input: ConflictResolutionInput,
): Promise<ConflictDetail> {
  // The scope read is outside the transaction: a 403 should not open one.
  const scope = await selectConflictScope(conflictId)
  if (!scope) throw new NotFoundError('Conflict not found')
  resolveBranchFilter(user, scope.branchId)

  // `resolved_by` prefers the staff id the shops use, and falls back to the user
  // id for an account that has none; one of the two is always present on a session.
  const resolvedBy = actor.actorStaffId ?? actor.actorId ?? null
  const resolutionNote = input.note?.trim() || null
  const resolvedAt = new Date()

  await db.transaction(async (tx) => {
    const current = await lockConflictForUpdate(conflictId, tx)
    if (!current) throw new NotFoundError('Conflict not found')
    // Re-checked against the locked row: the pre-read is a gate, this is the row
    // the update will touch.
    resolveBranchFilter(user, current.branchId)

    if (current.status !== 'OPEN') {
      throw new AppError(409, 'CONFLICT_ALREADY_RESOLVED', 'This conflict is already closed')
    }

    await updateConflictResolution(
      conflictId,
      {
        status: input.status,
        resolutionCode: input.code,
        resolutionNote,
        resolvedBy,
        resolvedAt,
      },
      tx,
    )

    await writeAudit(
      {
        ...actor,
        action: 'pos.conflict.resolved',
        entity: 'sync_conflict',
        entityId: conflictId,
        branchId: current.branchId,
        terminalId: current.terminalId,
        before: { status: 'OPEN', resolutionCode: null },
        after: {
          status: input.status,
          resolutionCode: input.code,
          resolutionNote,
        },
      },
      tx,
    )
  })

  return getConflict(user, conflictId)
}
