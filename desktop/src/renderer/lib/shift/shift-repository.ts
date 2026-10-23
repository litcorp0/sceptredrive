import type { PowerSyncDatabase, Transaction } from '@powersync/web'

/**
 * Local-only shift data access. All writes take the transaction the service
 * opened, so a shift/cash movement and its outbox row commit together.
 */

export interface LocalShift {
  id: string
  number: string
  branchId: string
  terminalId: string
  deviceId: string
  cashierUserId: string
  cashierStaffId: string
  status: 'OPEN' | 'CLOSED'
  openedAt: string
  closedAt: string | null
  openingFloatMinor: number
  countedCashMinor: number | null
  clientExpectedCashMinor: number | null
  closeNote: string | null
  openedBy: string | null
  closedBy: string | null
  createdAt: string
}

export interface LocalCashMovement {
  id: string
  shiftId: string
  type: 'CASH_IN' | 'CASH_OUT'
  amountMinor: number
  reason: string
  occurredAt: string
  staffUserId: string
  staffStaffId: string
}

export interface ShiftCashTotals {
  openingFloatMinor: number
  cashTendersMinor: number
  changeMinor: number
  cashInMinor: number
  cashOutMinor: number
}

interface ShiftRow {
  id: string
  number: string
  branch_id: string
  terminal_id: string
  device_id: string
  cashier_user_id: string
  cashier_staff_id: string
  status: string
  opened_at: string
  closed_at: string | null
  opening_float_minor: number
  counted_cash_minor: number | null
  client_expected_cash_minor: number | null
  close_note: string | null
  opened_by: string | null
  closed_by: string | null
  created_at: string
}

interface CashMovementRow {
  id: string
  shift_id: string
  type: string
  amount_minor: number
  reason: string
  occurred_at: string
  staff_user_id: string
  staff_staff_id: string
}

const SHIFT_COLUMNS = `id, number, branch_id, terminal_id, device_id, cashier_user_id,
  cashier_staff_id, status, opened_at, closed_at, opening_float_minor, counted_cash_minor,
  client_expected_cash_minor, close_note, opened_by, closed_by, created_at`

const MOVEMENT_COLUMNS = `id, shift_id, type, amount_minor, reason, occurred_at,
  staff_user_id, staff_staff_id`

function toShift(row: ShiftRow): LocalShift {
  return {
    id: row.id,
    number: row.number,
    branchId: row.branch_id,
    terminalId: row.terminal_id,
    deviceId: row.device_id,
    cashierUserId: row.cashier_user_id,
    cashierStaffId: row.cashier_staff_id,
    status: row.status === 'CLOSED' ? 'CLOSED' : 'OPEN',
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    openingFloatMinor: row.opening_float_minor,
    countedCashMinor: row.counted_cash_minor,
    clientExpectedCashMinor: row.client_expected_cash_minor,
    closeNote: row.close_note,
    openedBy: row.opened_by,
    closedBy: row.closed_by,
    createdAt: row.created_at,
  }
}

function toMovement(row: CashMovementRow): LocalCashMovement {
  return {
    id: row.id,
    shiftId: row.shift_id,
    type: row.type === 'CASH_OUT' ? 'CASH_OUT' : 'CASH_IN',
    amountMinor: row.amount_minor,
    reason: row.reason,
    occurredAt: row.occurred_at,
    staffUserId: row.staff_user_id,
    staffStaffId: row.staff_staff_id,
  }
}

export async function findOpenShift(
  db: PowerSyncDatabase,
  terminalId: string,
): Promise<LocalShift | null> {
  const row = await db.getOptional<ShiftRow>(
    `SELECT ${SHIFT_COLUMNS} FROM shift WHERE terminal_id = ? AND status = 'OPEN' LIMIT 1`,
    [terminalId],
  )
  return row ? toShift(row) : null
}

export async function findShiftById(
  db: PowerSyncDatabase,
  shiftId: string,
): Promise<LocalShift | null> {
  const row = await db.getOptional<ShiftRow>(`SELECT ${SHIFT_COLUMNS} FROM shift WHERE id = ?`, [
    shiftId,
  ])
  return row ? toShift(row) : null
}

export async function insertShift(tx: Transaction, shift: LocalShift): Promise<void> {
  await tx.execute(
    `INSERT INTO shift (${SHIFT_COLUMNS})
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      shift.id,
      shift.number,
      shift.branchId,
      shift.terminalId,
      shift.deviceId,
      shift.cashierUserId,
      shift.cashierStaffId,
      shift.status,
      shift.openedAt,
      shift.closedAt,
      shift.openingFloatMinor,
      shift.countedCashMinor,
      shift.clientExpectedCashMinor,
      shift.closeNote,
      shift.openedBy,
      shift.closedBy,
      shift.createdAt,
    ],
  )
}

export async function updateShiftClose(
  tx: Transaction,
  shiftId: string,
  patch: {
    status: 'CLOSED'
    closedAt: string
    countedCashMinor: number
    clientExpectedCashMinor: number
    closeNote: string | null
    closedBy: string | null
  },
): Promise<void> {
  await tx.execute(
    `UPDATE shift
        SET status = ?, closed_at = ?, counted_cash_minor = ?, client_expected_cash_minor = ?,
            close_note = ?, closed_by = ?
      WHERE id = ?`,
    [
      patch.status,
      patch.closedAt,
      patch.countedCashMinor,
      patch.clientExpectedCashMinor,
      patch.closeNote,
      patch.closedBy,
      shiftId,
    ],
  )
}

export async function insertCashMovement(
  tx: Transaction,
  movement: LocalCashMovement,
): Promise<void> {
  await tx.execute(
    `INSERT INTO cash_movement (${MOVEMENT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      movement.id,
      movement.shiftId,
      movement.type,
      movement.amountMinor,
      movement.reason,
      movement.occurredAt,
      movement.staffUserId,
      movement.staffStaffId,
    ],
  )
}

export async function listCashMovements(
  db: PowerSyncDatabase,
  shiftId: string,
): Promise<LocalCashMovement[]> {
  const rows = await db.getAll<CashMovementRow>(
    `SELECT ${MOVEMENT_COLUMNS} FROM cash_movement WHERE shift_id = ? ORDER BY occurred_at`,
    [shiftId],
  )
  return rows.map(toMovement)
}

/** Anything that can run a single-row read: the database or an open transaction. */
export interface SqlReader {
  getOptional<T>(sql: string, parameters?: unknown[]): Promise<T | null>
}

/**
 * Cash totals for the expected-cash formula: cash tenders minus change plus
 * cash in minus cash out. Reads the same local sale tables the selling UI writes.
 */
export async function selectShiftCashTotals(
  reader: SqlReader,
  shiftId: string,
  openingFloatMinor: number,
): Promise<ShiftCashTotals> {
  const row = await reader.getOptional<{
    cash_tenders: number
    change_total: number
    cash_in: number
    cash_out: number
  }>(
    `SELECT
       COALESCE((SELECT SUM(st.amount_minor) FROM sale_tender st
                   JOIN sale s ON s.id = st.sale_id
                  WHERE s.shift_id = ? AND st.method = 'CASH'), 0) AS cash_tenders,
       COALESCE((SELECT SUM(change_minor) FROM sale WHERE shift_id = ?), 0) AS change_total,
       COALESCE((SELECT SUM(amount_minor) FROM cash_movement
                  WHERE shift_id = ? AND type = 'CASH_IN'), 0) AS cash_in,
       COALESCE((SELECT SUM(amount_minor) FROM cash_movement
                  WHERE shift_id = ? AND type = 'CASH_OUT'), 0) AS cash_out`,
    [shiftId, shiftId, shiftId, shiftId],
  )

  return {
    openingFloatMinor,
    cashTendersMinor: row?.cash_tenders ?? 0,
    changeMinor: row?.change_total ?? 0,
    cashInMinor: row?.cash_in ?? 0,
    cashOutMinor: row?.cash_out ?? 0,
  }
}

/** Terminal/day sequence, allocated inside the caller's transaction. */
export async function nextDocumentValue(
  tx: Transaction,
  terminalId: string,
  scope: string,
  day: string,
): Promise<number> {
  const row = await tx.getOptional<{ last_value: number }>(
    `SELECT last_value FROM document_sequence WHERE terminal_id = ? AND scope = ? AND day = ?`,
    [terminalId, scope, day],
  )
  const next = (row?.last_value ?? 0) + 1
  await tx.execute(
    `INSERT OR REPLACE INTO document_sequence (id, terminal_id, scope, day, last_value)
     VALUES (?, ?, ?, ?, ?)`,
    [`${terminalId}:${scope}:${day}`, terminalId, scope, day, next],
  )
  return next
}

export interface OutboxRow {
  id: string
  clientTransactionId: string
  type: 'SALE' | 'SHIFT_OPEN' | 'CASH_MOVEMENT' | 'SHIFT_CLOSE'
  occurredAt: string
  payload: unknown
}

/** Durable FIFO upload row (D11). Never deleted before an ack. */
export async function insertOutbox(tx: Transaction, row: OutboxRow): Promise<void> {
  const now = new Date().toISOString()
  await tx.execute(
    `INSERT INTO outbox (id, client_transaction_id, type, occurred_at, payload_version, payload,
                         status, attempts, next_attempt_at, last_error, server_result,
                         created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, 'pending', 0, NULL, NULL, NULL, ?, ?)`,
    [
      row.id,
      row.clientTransactionId,
      row.type,
      row.occurredAt,
      JSON.stringify(row.payload),
      now,
      now,
    ],
  )
}
