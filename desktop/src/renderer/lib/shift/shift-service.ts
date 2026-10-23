import type { PowerSyncDatabase } from '@powersync/web'
import { getStaffSession, requireStaffSession, type StaffSession } from '../auth/staff-session'
import { nextDocumentValue } from '../document-sequence'
import { notifyOutboxChanged } from '../outbox/outbox-events'
import { type PosIdentity, readPosIdentity } from '../pos-config'
import { accraDay } from '../time'
import {
  findOpenShift,
  findShiftById,
  insertCashMovement,
  insertOutbox,
  insertShift,
  type LocalCashMovement,
  type LocalShift,
  listCashMovements,
  type ShiftCashTotals,
  selectShiftCashTotals,
} from './shift-repository'

/** Re-exported for the shift screen and the existing formatting tests. */
export { accraDay } from '../time'

/**
 * Offline shift lifecycle (POS-04).
 *
 * One open shift per terminal. Opening, cash movements, and closing each commit
 * the local fact and its outbox row in one transaction, so the terminal can be
 * killed at any point without losing an event. Selling is blocked until a shift
 * is open when `pos.salesRequireOpenShift` is set (Plan 06 enforces the gate).
 */

export type ShiftErrorCode =
  | 'ALREADY_OPEN'
  | 'NO_OPEN_SHIFT'
  | 'NOT_OWNER'
  | 'INVALID_AMOUNT'
  | 'NO_IDENTITY'
  | 'NOT_SIGNED_IN'

export class ShiftError extends Error {
  readonly code: ShiftErrorCode

  constructor(code: ShiftErrorCode, message: string) {
    super(message)
    this.name = 'ShiftError'
    this.code = code
  }
}

export function formatShiftNumber(terminalCode: string, day: string, sequence: number): string {
  return `${terminalCode}-S-${day}-${String(sequence).padStart(2, '0')}`
}

export function computeExpectedCash(totals: ShiftCashTotals): number {
  return (
    totals.openingFloatMinor +
    totals.cashTendersMinor -
    totals.changeMinor +
    totals.cashInMinor -
    totals.cashOutMinor
  )
}

export function computeVariance(countedCashMinor: number, expectedCashMinor: number): number {
  return countedCashMinor - expectedCashMinor
}

function assertAmount(amountMinor: number): void {
  if (!Number.isInteger(amountMinor) || amountMinor < 0) {
    throw new ShiftError('INVALID_AMOUNT', 'Amounts must be non-negative whole pesewas')
  }
}

function sessionOrThrow(): StaffSession {
  try {
    return requireStaffSession()
  } catch {
    throw new ShiftError('NOT_SIGNED_IN', 'Sign in with a PIN first')
  }
}

async function identityOrThrow(db: PowerSyncDatabase): Promise<PosIdentity> {
  const identity = await readPosIdentity(db)
  if (!identity) {
    throw new ShiftError('NO_IDENTITY', 'This terminal is not configured yet')
  }
  return identity
}

async function openShiftOrThrow(
  db: PowerSyncDatabase,
  identity: PosIdentity,
  staff: StaffSession,
): Promise<LocalShift> {
  const open = await findOpenShift(db, identity.terminalId)
  if (!open) throw new ShiftError('NO_OPEN_SHIFT', 'Open a shift before recording cash')
  if (open.cashierUserId !== staff.userId) {
    throw new ShiftError('NOT_OWNER', 'Only the cashier who opened this shift can use it')
  }
  return open
}

export interface OpenShiftInput {
  openingFloatMinor: number
}

export async function openShift(db: PowerSyncDatabase, input: OpenShiftInput): Promise<LocalShift> {
  assertAmount(input.openingFloatMinor)
  const staff = sessionOrThrow()
  const identity = await identityOrThrow(db)

  const existing = await findOpenShift(db, identity.terminalId)
  if (existing) {
    if (existing.cashierUserId === staff.userId) return existing
    throw new ShiftError(
      'ALREADY_OPEN',
      `A shift is already open on this terminal (${existing.number})`,
    )
  }

  const now = new Date()
  const openedAt = now.toISOString()
  const shiftId = crypto.randomUUID()

  await db.writeTransaction(async (tx) => {
    const sequence = await nextDocumentValue(tx, identity.terminalId, 'shift', accraDay(now))
    const number = formatShiftNumber(identity.terminalCode, accraDay(now), sequence)

    const shiftRow: LocalShift = {
      id: shiftId,
      number,
      branchId: identity.branchId,
      terminalId: identity.terminalId,
      deviceId: identity.deviceId,
      cashierUserId: staff.userId,
      cashierStaffId: staff.staffId,
      status: 'OPEN',
      openedAt,
      closedAt: null,
      openingFloatMinor: input.openingFloatMinor,
      countedCashMinor: null,
      clientExpectedCashMinor: null,
      closeNote: null,
      openedBy: staff.staffId,
      closedBy: null,
      createdAt: openedAt,
    }
    await insertShift(tx, shiftRow)

    await insertOutbox(tx, {
      id: shiftId,
      clientTransactionId: shiftId,
      type: 'SHIFT_OPEN',
      occurredAt: openedAt,
      payload: {
        shiftId,
        number,
        openingFloatMinor: input.openingFloatMinor,
        cashierUserId: staff.userId,
        cashierStaffId: staff.staffId,
        occurredAt: openedAt,
      },
    })
  })
  notifyOutboxChanged()

  const created = await findShiftById(db, shiftId)
  if (!created) throw new ShiftError('NO_OPEN_SHIFT', 'Shift could not be read back')
  return created
}

export interface CashMovementInput {
  type: 'CASH_IN' | 'CASH_OUT'
  amountMinor: number
  reason: string
}

export async function recordCashMovement(
  db: PowerSyncDatabase,
  input: CashMovementInput,
): Promise<LocalCashMovement> {
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new ShiftError('INVALID_AMOUNT', 'A cash movement must be greater than zero')
  }
  if (!input.reason.trim()) {
    throw new ShiftError('INVALID_AMOUNT', 'A cash movement needs a reason')
  }

  const staff = sessionOrThrow()
  const identity = await identityOrThrow(db)
  const shift = await openShiftOrThrow(db, identity, staff)

  const now = new Date().toISOString()
  const movement: LocalCashMovement = {
    id: crypto.randomUUID(),
    shiftId: shift.id,
    type: input.type,
    amountMinor: input.amountMinor,
    reason: input.reason.trim(),
    occurredAt: now,
    staffUserId: staff.userId,
    staffStaffId: staff.staffId,
  }

  await db.writeTransaction(async (tx) => {
    await insertCashMovement(tx, movement)
    await insertOutbox(tx, {
      id: movement.id,
      clientTransactionId: movement.id,
      type: 'CASH_MOVEMENT',
      occurredAt: now,
      payload: {
        id: movement.id,
        shiftId: shift.id,
        type: movement.type,
        amountMinor: movement.amountMinor,
        reason: movement.reason,
        occurredAt: now,
        staffUserId: staff.userId,
        staffStaffId: staff.staffId,
      },
    })
  })
  notifyOutboxChanged()

  return movement
}

export interface CloseShiftInput {
  countedCashMinor: number
  note?: string | undefined
}

export interface CloseShiftResult {
  shift: LocalShift
  expectedCashMinor: number
  varianceMinor: number
}

export async function closeShift(
  db: PowerSyncDatabase,
  input: CloseShiftInput,
): Promise<CloseShiftResult> {
  assertAmount(input.countedCashMinor)
  const staff = sessionOrThrow()
  const identity = await identityOrThrow(db)
  const shift = await openShiftOrThrow(db, identity, staff)

  const closedAt = new Date().toISOString()
  const closeTransactionId = crypto.randomUUID()
  let expectedCashMinor = 0
  let varianceMinor = 0

  await db.writeTransaction(async (tx) => {
    const totals = await selectShiftCashTotals(tx, shift.id, shift.openingFloatMinor)
    expectedCashMinor = computeExpectedCash(totals)
    varianceMinor = computeVariance(input.countedCashMinor, expectedCashMinor)

    await tx.execute(
      `UPDATE shift
          SET status = 'CLOSED', closed_at = ?, counted_cash_minor = ?,
              client_expected_cash_minor = ?, close_note = ?, closed_by = ?
        WHERE id = ?`,
      [
        closedAt,
        input.countedCashMinor,
        expectedCashMinor,
        input.note?.trim() || null,
        staff.staffId,
        shift.id,
      ],
    )

    await insertOutbox(tx, {
      id: closeTransactionId,
      clientTransactionId: closeTransactionId,
      type: 'SHIFT_CLOSE',
      occurredAt: closedAt,
      payload: {
        shiftId: shift.id,
        countedCashMinor: input.countedCashMinor,
        clientExpectedCashMinor: expectedCashMinor,
        closeNote: input.note?.trim() || null,
        occurredAt: closedAt,
      },
    })
  })
  notifyOutboxChanged()

  const closed = await findShiftById(db, shift.id)
  if (!closed) throw new ShiftError('NO_OPEN_SHIFT', 'Shift could not be read back')

  return { shift: closed, expectedCashMinor, varianceMinor }
}

export interface ShiftState {
  shift: LocalShift | null
  expectedCashMinor: number
  movements: LocalCashMovement[]
}

/** Everything the shift screen renders: the open shift, its cash movements, expected cash. */
export async function loadShiftState(db: PowerSyncDatabase): Promise<ShiftState> {
  const identity = await readPosIdentity(db)
  const session = getStaffSession()
  if (!identity || !session) return { shift: null, expectedCashMinor: 0, movements: [] }

  const shift = await findOpenShift(db, identity.terminalId)
  if (!shift) return { shift: null, expectedCashMinor: 0, movements: [] }

  const [movements, totals] = await Promise.all([
    listCashMovements(db, shift.id),
    selectShiftCashTotals(db, shift.id, shift.openingFloatMinor),
  ])

  return {
    shift,
    expectedCashMinor: computeExpectedCash(totals),
    movements,
  }
}
