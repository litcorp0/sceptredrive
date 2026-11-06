import type { PowerSyncDatabase } from '@powersync/web'
import { accraDay, type Role } from '@sceptre/shared'
import { getStaffSession, requireStaffSession, type StaffSession } from '../auth/staff-session'
import { nextDocumentValue } from '../document-sequence'
import { notifyOutboxChanged } from '../outbox/outbox-events'
import { type PosIdentity, readPosIdentity } from '../pos-config'
import {
  type LocalShiftReport,
  localShiftReport,
  readShiftFigures,
  writeShiftReport,
} from './shift-report'
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
  updateShiftClose,
} from './shift-repository'

/** Re-exported for the shift screen and the existing formatting tests. */
export { accraDay } from '@sceptre/shared'

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

/**
 * Expected cash = float + cash tenders − change + cash in − cash out − cash
 * refunds + cash credit repayments.
 *
 * The refund term is not optional bookkeeping: a settled cash refund is money
 * that physically left this drawer, so without it the till expects cash it has
 * already given back. Card and MoMo refunds are absent by construction — they
 * never touched the notes (`selectShiftCashTotals` filters `CASH`/`SETTLED`).
 *
 * The repayment term is the same argument in the other direction (P20-D1): a
 * customer paying a debt in cash hands over notes that go in this drawer, so the
 * till expects them. Without it every cash repayment closes as an overage.
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

/** Roles that may take over a drawer somebody else opened (P14-D12). */
const TAKE_OVER_ROLES: readonly Role[] = ['MANAGER', 'ADMIN']

/** True when the signed-in staff member opened this drawer themselves. */
export function isOwnDrawer(
  shift: Pick<LocalShift, 'cashierUserId'>,
  staff: Pick<StaffSession, 'userId'>,
): boolean {
  return shift.cashierUserId === staff.userId
}

/**
 * Who may close this drawer: `CASHIER` for the person who opened it, `MANAGER`
 * for a manager or admin taking a drawer over at shift end, `null` for anyone
 * else.
 *
 * The terminal lookup already scopes a shift to this device, so the branch term
 * is belt and braces: a shift row that reached this till from another branch
 * (a re-assigned device, a bad sync) is still refused to a manager of ours.
 * Server-side authorisation is unchanged and authoritative — this is the same
 * rule the API applies, checked before the counter writes anything.
 */
export function closeAuthority(
  shift: Pick<LocalShift, 'cashierUserId' | 'branchId'>,
  staff: Pick<StaffSession, 'userId' | 'role'>,
  terminalBranchId: string,
): 'CASHIER' | 'MANAGER' | null {
  if (isOwnDrawer(shift, staff)) return 'CASHIER'
  const takesOver = TAKE_OVER_ROLES.includes(staff.role)
  return takesOver && shift.branchId === terminalBranchId ? 'MANAGER' : null
}

/**
 * The shift a close may act on, or `NOT_OWNER`.
 *
 * Closing is the one shift action a manager may perform on another cashier's
 * drawer: the count, the variance, the Z and the outbox row are all unchanged,
 * and the payload still names the signed-in staff member, so the server records
 * the manager as the closer and the variance review as theirs (P13-D41).
 */
async function resolveShiftForClose(
  db: PowerSyncDatabase,
  identity: PosIdentity,
  staff: StaffSession,
): Promise<LocalShift> {
  const open = await findOpenShift(db, identity.terminalId)
  if (!open) throw new ShiftError('NO_OPEN_SHIFT', 'There is no open shift to close')
  if (closeAuthority(open, staff, identity.branchId) === null) {
    throw new ShiftError(
      'NOT_OWNER',
      'Only the cashier who opened this drawer, or a manager in this branch, can close it',
    )
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
  /**
   * The signed-in binding, sent with the close so the server's variance review
   * names the person who actually closed the drawer (P13-D41). Optional: an old
   * till that omits it falls back to the shift's cashier, which is Phase 12's
   * behaviour.
   */
  closedBy?: CloseStaffProof | null | undefined
  /** Injectable clock; the Z snapshot's times and the close must agree. */
  now?: Date | undefined
}

/** The five fields the server resolves against the device's own binding (P13-D41). */
export interface CloseStaffProof {
  userId: string
  staffId: string
  bindingId: string
  bindingToken: string
  pinVersion: number
}

export interface CloseShiftResult {
  shift: LocalShift
  expectedCashMinor: number
  varianceMinor: number
  /** The frozen Z snapshot, written in the close's own transaction (P13-D32). */
  report: LocalShiftReport
}

/**
 * Closes the shift, and writes the Z snapshot in the **same** transaction.
 *
 * The caller is the shift's own cashier or a manager/admin in this branch
 * (`resolveShiftForClose`); either way the row and the outbox payload name the
 * signed-in staff member, so a takeover is recorded as one.
 *
 * Three facts commit or vanish together: the shift row closes, the
 * `SHIFT_CLOSE` outbox row is queued with the closer's proof, and the frozen
 * figures are inserted. A crash rolls all of them back, so the shift stays open
 * and can be closed again — a snapshot written in a second transaction could be
 * lost to exactly the crash the snapshot exists to survive.
 */
export async function closeShift(
  db: PowerSyncDatabase,
  input: CloseShiftInput,
): Promise<CloseShiftResult> {
  assertAmount(input.countedCashMinor)
  const staff = sessionOrThrow()
  const identity = await identityOrThrow(db)
  const shift = await resolveShiftForClose(db, identity, staff)

  const now = input.now ?? new Date()
  const closedAt = now.toISOString()
  const closeTransactionId = crypto.randomUUID()
  const closeNote = input.note?.trim() || null
  let expectedCashMinor = 0
  let varianceMinor = 0
  let report: LocalShiftReport | null = null

  await db.writeTransaction(async (tx) => {
    const totals = await selectShiftCashTotals(tx, shift.id, shift.openingFloatMinor)
    expectedCashMinor = computeExpectedCash(totals)
    varianceMinor = computeVariance(input.countedCashMinor, expectedCashMinor)

    await updateShiftClose(tx, shift.id, {
      status: 'CLOSED',
      closedAt,
      countedCashMinor: input.countedCashMinor,
      clientExpectedCashMinor: expectedCashMinor,
      closeNote,
      closedBy: staff.staffId,
    })

    await insertOutbox(tx, {
      id: closeTransactionId,
      clientTransactionId: closeTransactionId,
      type: 'SHIFT_CLOSE',
      occurredAt: closedAt,
      payload: {
        shiftId: shift.id,
        countedCashMinor: input.countedCashMinor,
        clientExpectedCashMinor: expectedCashMinor,
        closeNote,
        occurredAt: closedAt,
        ...(input.closedBy ? { closedBy: input.closedBy } : {}),
      },
    })

    // Read inside the transaction: the figures are the rows this close sees, so
    // a report and a stored close cannot be one sale apart.
    const figures = await readShiftFigures(tx, shift.id)
    const closedShift: LocalShift = {
      ...shift,
      status: 'CLOSED',
      closedAt,
      countedCashMinor: input.countedCashMinor,
      clientExpectedCashMinor: expectedCashMinor,
      closeNote,
      closedBy: staff.staffId,
    }
    report = localShiftReport(closedShift, figures, expectedCashMinor, closedAt)
    await writeShiftReport(tx, report)
  })
  notifyOutboxChanged()

  const closed = await findShiftById(db, shift.id)
  if (!closed) throw new ShiftError('NO_OPEN_SHIFT', 'Shift could not be read back')
  if (!report) throw new ShiftError('NO_OPEN_SHIFT', 'The close wrote no report')

  return { shift: closed, expectedCashMinor, varianceMinor, report }
}

export interface ShiftState {
  shift: LocalShift | null
  expectedCashMinor: number
  /**
   * The terms `expectedCashMinor` was computed from (P20-D10).
   *
   * Carried so a screen can show *why* the drawer holds what it holds. Without it the home
   * screen shows "take GHS 4,245" beside "drawer GHS 2,930" and the difference reads as a
   * shortage, when it is a MoMo payment that never touched the notes.
   */
  cashTotals: ShiftCashTotals | null
  movements: LocalCashMovement[]
}

/** Everything the shift screen renders: the open shift, its cash movements, expected cash. */
export async function loadShiftState(db: PowerSyncDatabase): Promise<ShiftState> {
  const identity = await readPosIdentity(db)
  const session = getStaffSession()
  if (!identity || !session) {
    return { shift: null, expectedCashMinor: 0, cashTotals: null, movements: [] }
  }

  const shift = await findOpenShift(db, identity.terminalId)
  if (!shift) return { shift: null, expectedCashMinor: 0, cashTotals: null, movements: [] }

  const [movements, totals] = await Promise.all([
    listCashMovements(db, shift.id),
    selectShiftCashTotals(db, shift.id, shift.openingFloatMinor),
  ])

  return {
    shift,
    expectedCashMinor: computeExpectedCash(totals),
    cashTotals: totals,
    movements,
  }
}
