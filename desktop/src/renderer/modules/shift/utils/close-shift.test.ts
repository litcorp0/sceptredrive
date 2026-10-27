import type { PowerSyncDatabase } from '@powersync/web'
import { afterEach, describe, expect, it } from 'vitest'
import type { LocalStaffBinding } from '@/lib/auth/bindings'
import { endStaffSession, startStaffSession } from '@/lib/auth/staff-session'
import type { LocalShift } from '@/lib/shift/shift-repository'
import { CloseShiftError, closeShiftWithReport } from './close-shift'

/**
 * The close with its holds step and its Z snapshot (P13-D30, P13-D32, P13-D41).
 *
 * Every case is a promise the drawer makes: a close with holds cannot proceed
 * without an answer, `keep` touches nothing, `void all` leaves one recorded
 * `CUSTOMER_LEFT` per cart, the stored report equals the local recomputation,
 * exactly one `SHIFT_CLOSE` leaves the till, and that payload names the person
 * who closed the drawer. A report that cannot be written never un-closes a shift.
 */

const NOW = new Date('2026-10-27T18:30:00.000Z')

const BINDING: LocalStaffBinding = {
  // The close stays with the shift's own cashier: `closeShift` refuses anyone
  // else, so the drawer and the name on it are the same person by construction.
  id: 'binding-cashier',
  userId: 'user-cashier',
  staffId: 'GA-0003',
  name: 'Ama Mensah',
  role: 'CASHIER',
  bindingId: 'binding-cashier',
  bindingToken: 'cashier-token',
  expiresAt: '2099-01-01T00:00:00.000Z',
  pinSalt: 'salt',
  pinVerifier: 'verifier',
  pinVersion: 2,
  pinMustChange: false,
  failedAttempts: 0,
  lockedUntil: null,
  isActive: true,
  boundAt: '2026-10-01T00:00:00.000Z',
}

const CONFIG = {
  device_id: 'device-1',
  terminal_id: 'terminal-1',
  terminal_code: 'ACC-SPX-T01',
  branch_id: 'branch-1',
  branch_code: 'ACC-SPX',
}

const SHIFT: LocalShift = {
  id: 'shift-1',
  number: 'ACC-SPX-T01-S-20261027-01',
  branchId: 'branch-1',
  terminalId: 'terminal-1',
  deviceId: 'device-1',
  cashierUserId: 'user-cashier',
  cashierStaffId: 'GA-0003',
  status: 'OPEN',
  openedAt: '2026-10-27T08:00:00.000Z',
  closedAt: null,
  openingFloatMinor: 20_000,
  countedCashMinor: null,
  clientExpectedCashMinor: null,
  closeNote: null,
  openedBy: 'GA-0003',
  closedBy: null,
  createdAt: '2026-10-27T08:00:00.000Z',
}

/** What the local table returns: the snake_case row the repository maps. */
const SHIFT_ROW = {
  id: SHIFT.id,
  number: SHIFT.number,
  branch_id: SHIFT.branchId,
  terminal_id: SHIFT.terminalId,
  device_id: SHIFT.deviceId,
  cashier_user_id: SHIFT.cashierUserId,
  cashier_staff_id: SHIFT.cashierStaffId,
  status: SHIFT.status,
  opened_at: SHIFT.openedAt,
  closed_at: SHIFT.closedAt,
  opening_float_minor: SHIFT.openingFloatMinor,
  counted_cash_minor: SHIFT.countedCashMinor,
  client_expected_cash_minor: SHIFT.clientExpectedCashMinor,
  close_note: SHIFT.closeNote,
  opened_by: SHIFT.openedBy,
  closed_by: SHIFT.closedBy,
  created_at: SHIFT.createdAt,
}

const BINDING_ROW = {
  id: BINDING.id,
  user_id: BINDING.userId,
  staff_id: BINDING.staffId,
  name: BINDING.name,
  role: BINDING.role,
  binding_id: BINDING.bindingId,
  binding_token: BINDING.bindingToken,
  expires_at: BINDING.expiresAt,
  pin_salt: BINDING.pinSalt,
  pin_verifier: BINDING.pinVerifier,
  pin_version: BINDING.pinVersion,
  pin_must_change: 0,
  failed_attempts: 0,
  locked_until: null,
  is_active: 1,
  bound_at: BINDING.boundAt,
}

/**
 * One row answers both readers: the close's cash totals and the report's
 * aggregates. The two must agree, and here they do by construction.
 */
const FIGURES = {
  cash_tenders: 30_000,
  change_total: 2_000,
  cash_in: 5_000,
  cash_out: 1_000,
  sale_count: 3,
  item_count: 7,
  refund_count: 1,
  void_count: 2,
  gross_minor: 45_000,
  refund_minor: 5_000,
  line_discount_minor: 0,
  sale_discount_minor: 1_000,
  loyalty_discount_minor: 500,
  loyalty_redeem_points: 100,
  loyalty_earned_points: 30,
  base_minor: 36_250,
  vat_minor: 5_437,
  nhil_minor: 906,
  getfund_minor: 906,
  tax_total_minor: 7_249,
  cash_minor: 30_000,
  credit_minor: 5_000,
  momo_minor: 10_000,
  card_minor: 0,
  bank_transfer_minor: 0,
  change_minor: 2_000,
  cash_in_minor: 5_000,
  cash_out_minor: 1_000,
  cash_refunds: 0,
  cash_refunds_minor: 0,
}

interface Write {
  sql: string
  parameters: unknown[] | undefined
}

interface HoldRow {
  id: string
  label: string
  held_at: string
  item_count: number
  total_minor: number
}

function hold(id: string, label: string): HoldRow {
  return {
    id,
    label,
    held_at: '2026-10-27T09:00:00.000Z',
    item_count: 2,
    total_minor: 12_000,
  }
}

function fakeDb(
  options: {
    holds?: HoldRow[]
    figures?: Partial<typeof FIGURES>
    failOn?: (sql: string) => boolean
  } = {},
) {
  const holds = [...(options.holds ?? [])]
  const figures = { ...FIGURES, ...options.figures }
  const written: Write[] = []
  const outbox = new Map<string, string>()
  let shiftRow = { ...SHIFT_ROW }
  let reports = 0

  async function readOne(sql: string, parameters?: unknown[]): Promise<unknown> {
    if (/FROM pos_config/.test(sql)) return CONFIG
    if (/FROM staff_binding/.test(sql)) return BINDING_ROW
    if (/COUNT\(\*\) AS total FROM held_cart/.test(sql)) return { total: holds.length }
    if (/FROM held_cart WHERE id/.test(sql)) {
      const found = holds.find((row) => row.id === parameters?.[0])
      return found
        ? {
            ...found,
            held_by_user_id: BINDING.userId,
            held_by_staff_id: BINDING.staffId,
            shift_id: shiftRow.id,
            customer_id: null,
            customer_name: null,
            customer_phone: null,
            loyalty_redeem_points: 0,
            sale_discount_minor: 0,
            sale_discount_reason: null,
            sale_discount_note: null,
            sale_discount_override: null,
            subtotal_minor: 12_000,
          }
        : null
    }
    if (/FROM shift\b/.test(sql)) return shiftRow
    if (/FROM outbox/.test(sql)) {
      const payload = outbox.get(String(parameters?.[0]))
      return payload ? { payload } : null
    }
    if (/AS sale_count/.test(sql)) return figures
    if (/AS cash_tenders/.test(sql)) return figures
    if (/FROM held_cart hc/.test(sql)) {
      return holds.map((row) => ({
        id: row.id,
        label: row.label,
        held_at: row.held_at,
        held_by_user_id: BINDING.userId,
        held_by_staff_id: BINDING.staffId,
        held_by_name: BINDING.name,
        customer_name: null,
        item_count: row.item_count,
        total_minor: row.total_minor,
      }))
    }
    return null
  }

  async function readAll(sql: string, parameters?: unknown[]): Promise<unknown[]> {
    if (/FROM outbox/.test(sql)) {
      return [...outbox.entries()].map(([id, payload]) => {
        const parsed = JSON.parse(payload) as { shiftId?: string }
        return { id, payload, shiftId: parsed.shiftId }
      })
    }
    if (/FROM held_cart_line/.test(sql)) {
      return [
        {
          hold_id: String(parameters?.[0]),
          line_number: 1,
          product_id: 'p-pad',
          sku: 'BP-1',
          name: 'Brake pad set',
          barcode: null,
          quantity: 2,
          unit_price_minor: 6_000,
          tax_category: 'STANDARD',
          line_discount_minor: 0,
          line_discount_reason: null,
          line_discount_note: null,
          line_discount_override: null,
        },
      ]
    }
    const one = await readOne(sql, parameters)
    if (Array.isArray(one)) return one
    return one ? [one] : []
  }

  function apply(write: Write): void {
    const { sql, parameters } = write
    if (sql.includes('INSERT INTO outbox')) {
      outbox.set(String(parameters?.[0]), String(parameters?.[4]))
      return
    }
    if (sql.includes('UPDATE outbox SET payload')) {
      outbox.set(String(parameters?.[2]), String(parameters?.[0]))
      return
    }
    if (sql.includes('UPDATE shift')) {
      // `updateShiftClose` order: status, closed_at, counted, client expected,
      // note, closed_by, id.
      shiftRow = {
        ...shiftRow,
        status: 'CLOSED',
        closed_at: String(parameters?.[1]),
        counted_cash_minor: Number(parameters?.[2]),
        client_expected_cash_minor: Number(parameters?.[3]),
        close_note: (parameters?.[4] as string | null) ?? null,
        closed_by: (parameters?.[5] as string | null) ?? null,
      }
      return
    }
    if (sql.includes('INSERT INTO shift_report')) {
      reports += 1
      return
    }
    if (sql.includes('DELETE FROM held_cart_line WHERE hold_id')) {
      return
    }
    if (sql.includes('DELETE FROM held_cart WHERE id')) {
      const index = holds.findIndex((row) => row.id === parameters?.[0])
      if (index >= 0) holds.splice(index, 1)
    }
  }

  const db = {
    getOptional: async (sql: string, parameters?: unknown[]) => readOne(sql, parameters),
    getAll: async (sql: string, parameters?: unknown[]) => readAll(sql, parameters),
    async writeTransaction<T>(
      work: (tx: {
        getOptional: (sql: string, parameters?: unknown[]) => Promise<unknown>
        getAll: (sql: string, parameters?: unknown[]) => Promise<unknown[]>
        execute: (sql: string, parameters?: unknown[]) => Promise<unknown>
      }) => Promise<T>,
    ): Promise<T> {
      const pending: Write[] = []
      const tx = {
        getOptional: async (sql: string, parameters?: unknown[]) => readOne(sql, parameters),
        getAll: async (sql: string, parameters?: unknown[]) => readAll(sql, parameters),
        execute: async (sql: string, parameters?: unknown[]) => {
          if (options.failOn?.(sql)) throw new Error('injected write failure')
          pending.push({ sql, parameters })
        },
      }
      const result = await work(tx)
      written.push(...pending)
      for (const write of pending) apply(write)
      return result
    },
  }

  return {
    db: db as unknown as PowerSyncDatabase,
    get holds() {
      return holds
    },
    get shift(): LocalShift {
      return {
        ...SHIFT,
        status: shiftRow.status === 'CLOSED' ? 'CLOSED' : 'OPEN',
        closedAt: shiftRow.closed_at,
        countedCashMinor: shiftRow.counted_cash_minor,
        clientExpectedCashMinor: shiftRow.client_expected_cash_minor,
        closeNote: shiftRow.close_note,
        closedBy: shiftRow.closed_by,
      }
    },
    get reports() {
      return reports
    },
    /** The `SHIFT_CLOSE` row's current payload, after any enrichment. */
    get shiftClosePayload(): Record<string, unknown> | null {
      for (const payload of outbox.values()) {
        const parsed = JSON.parse(payload) as { shiftId?: string; countedCashMinor?: number }
        if (parsed.shiftId === SHIFT.id && parsed.countedCashMinor !== undefined) return parsed
      }
      return null
    },
    written,
    outbox,
  }
}

function startCashier(): void {
  startStaffSession(BINDING)
}

afterEach(() => {
  endStaffSession()
})

describe('closeShiftWithReport', () => {
  it('refuses to close while a hold is unanswered', async () => {
    startCashier()
    const fake = fakeDb({ holds: [hold('h-1', 'Ama’s pads')] })

    await expect(
      closeShiftWithReport(fake.db, { countedCashMinor: 51_500 }, { now: NOW }),
    ).rejects.toBeInstanceOf(CloseShiftError)

    expect(fake.shift.status).toBe('OPEN')
    expect(fake.written).toHaveLength(0)
  })

  it('keeps the holds when the cashier says keep', async () => {
    startCashier()
    const fake = fakeDb({ holds: [hold('h-1', 'Ama’s pads')] })

    const result = await closeShiftWithReport(
      fake.db,
      { countedCashMinor: 51_500, holdsDecision: 'KEEP' },
      { now: NOW },
    )

    expect(result.voidedHolds).toBe(0)
    expect(fake.holds).toHaveLength(1)
    expect(fake.written.some((write) => write.sql.includes('INSERT INTO cart_void'))).toBe(false)
    expect(result.report.voidCount).toBe(FIGURES.void_count)
  })

  it('writes one CUSTOMER_LEFT void per hold when the cashier voids all', async () => {
    startCashier()
    const fake = fakeDb({
      holds: [hold('h-1', 'Ama’s pads'), hold('h-2', 'Queue two')],
    })

    const result = await closeShiftWithReport(
      fake.db,
      { countedCashMinor: 51_500, holdsDecision: 'VOID_ALL' },
      { now: NOW },
    )

    expect(result.voidedHolds).toBe(2)
    expect(fake.holds).toHaveLength(0)

    const voids = fake.written.filter((write) => write.sql.includes('INSERT INTO cart_void'))
    expect(voids).toHaveLength(2)
    const payloads = fake.written
      .filter(
        (write) =>
          write.sql.includes('INSERT INTO outbox') && write.parameters?.[2] === 'CART_VOID',
      )
      .map(
        (write) =>
          JSON.parse(String(write.parameters?.[4])) as {
            reasonCode: string
            note: string
            label: string
          },
      )
    expect(payloads.map((payload) => payload.reasonCode)).toEqual([
      'CUSTOMER_LEFT',
      'CUSTOMER_LEFT',
    ])
    expect(payloads[0]?.note).toContain('Ama’s pads')
    expect(payloads[0]?.label).toBe('Ama’s pads')
    expect(payloads[1]?.note).toContain('Queue two')
  })

  it('writes the report and one SHIFT_CLOSE row that names the closer', async () => {
    startCashier()
    const fake = fakeDb({ holds: [hold('h-1', 'Ama’s pads')] })

    const result = await closeShiftWithReport(
      fake.db,
      { countedCashMinor: 51_500, note: 'Short by 5', holdsDecision: 'KEEP' },
      { now: NOW },
    )

    expect(fake.reports).toBe(1)
    expect(result.report.generatedAt).toBe(NOW.toISOString())
    expect(fake.shift.status).toBe('CLOSED')

    const closes = fake.written.filter(
      (write) =>
        write.sql.includes('INSERT INTO outbox') && write.parameters?.[2] === 'SHIFT_CLOSE',
    )
    expect(closes).toHaveLength(1)

    const payload = fake.shiftClosePayload as {
      shiftId: string
      countedCashMinor: number
      clientExpectedCashMinor: number
      closedBy: { staffId: string; bindingId: string; pinVersion: number } | null
    }
    expect(payload.shiftId).toBe(SHIFT.id)
    expect(payload.countedCashMinor).toBe(51_500)
    expect(payload.clientExpectedCashMinor).toBe(52_000)
    expect(payload.closedBy).toMatchObject({
      staffId: BINDING.staffId,
      bindingId: BINDING.bindingId,
      pinVersion: BINDING.pinVersion,
    })
  })

  it('stores a snapshot equal to the local recomputation', async () => {
    startCashier()
    const fake = fakeDb()

    const result = await closeShiftWithReport(
      fake.db,
      { countedCashMinor: 51_500, holdsDecision: 'KEEP' },
      { now: NOW },
    )

    // Expected cash: float + cash − change + in − out − cash refunds (one
    // formula, the close's).
    expect(result.expectedCashMinor).toBe(52_000)
    expect(result.varianceMinor).toBe(-500)

    const insert = fake.written.find((write) => write.sql.includes('INTO shift_report'))
    const columns = /\(([^)]+)\)\s*VALUES/s
      .exec(insert?.sql ?? '')?.[1]
      ?.split(',')
      .map((column) => column.trim())
    const params = insert?.parameters ?? []
    expect(columns).toBeDefined()
    expect(params).toHaveLength(columns?.length ?? -1)

    const row: Record<string, unknown> = {}
    for (const [index, column] of (columns ?? []).entries()) row[column] = params[index]

    // The whole row is the report object, field for field.
    expect(row.shift_id).toBe(result.report.shiftId)
    expect(row.number).toBe(result.report.number)
    expect(row.opened_at).toBe(result.report.openedAt)
    expect(row.closed_at).toBe(result.report.closedAt)
    expect(row.opening_float_minor).toBe(20_000)
    expect(row.sale_count).toBe(FIGURES.sale_count)
    expect(row.item_count).toBe(FIGURES.item_count)
    expect(row.refund_count).toBe(FIGURES.refund_count)
    expect(row.void_count).toBe(FIGURES.void_count)
    expect(row.gross_minor).toBe(FIGURES.gross_minor)
    expect(row.refund_minor).toBe(FIGURES.refund_minor)
    expect(row.net_minor).toBe(FIGURES.gross_minor - FIGURES.refund_minor)
    expect(row.base_minor).toBe(FIGURES.base_minor)
    expect(row.tax_total_minor).toBe(FIGURES.tax_total_minor)
    expect(row.cash_minor).toBe(FIGURES.cash_minor)
    expect(row.credit_minor).toBe(FIGURES.credit_minor)
    expect(row.momo_minor).toBe(FIGURES.momo_minor)
    expect(row.expected_cash_minor).toBe(52_000)
    expect(row.counted_cash_minor).toBe(51_500)
    expect(row.variance_minor).toBe(-500)
    expect(row.created_at).toBe(NOW.toISOString())
  })

  it('nets a settled cash refund out of the close and its stored snapshot', async () => {
    startCashier()
    const fake = fakeDb({
      figures: {
        cash_tenders: 180_000,
        change_total: 0,
        cash_in: 10_000,
        cash_out: 0,
        cash_refunds: 50_000,
        cash_minor: 180_000,
        change_minor: 0,
        cash_in_minor: 10_000,
        cash_out_minor: 0,
        cash_refunds_minor: 50_000,
      },
    })

    const result = await closeShiftWithReport(
      fake.db,
      { countedCashMinor: 160_000, holdsDecision: 'KEEP' },
      { now: NOW },
    )

    // float 20 000 + cash 180 000 − change 0 + in 10 000 − out 0 − refunds 50 000.
    // A pending card refund is not cash and never touches this arithmetic.
    expect(result.expectedCashMinor).toBe(160_000)
    expect(result.varianceMinor).toBe(0)

    const insert = fake.written.find((write) => write.sql.includes('INTO shift_report'))
    const columns = /\(([^)]+)\)\s*VALUES/s
      .exec(insert?.sql ?? '')?.[1]
      ?.split(',')
      .map((column) => column.trim())
    const params = insert?.parameters ?? []
    const row: Record<string, unknown> = {}
    for (const [index, column] of (columns ?? []).entries()) row[column] = params[index]

    expect(row.expected_cash_minor).toBe(160_000)
    expect(row.counted_cash_minor).toBe(160_000)
    expect(row.variance_minor).toBe(0)
    // The refund did not change the cash the shift took; it changed what is left.
    expect(row.cash_minor).toBe(180_000)
    expect(row.cash_in_minor).toBe(10_000)
  })

  it('writes nothing when the close transaction fails, and leaves the shift open', async () => {
    startCashier()
    const fake = fakeDb({ failOn: (sql) => sql.includes('INTO shift_report') })

    await expect(
      closeShiftWithReport(
        fake.db,
        { countedCashMinor: 51_500, holdsDecision: 'KEEP' },
        { now: NOW },
      ),
    ).rejects.toThrow('injected write failure')

    // One transaction: the close, its outbox row, and the snapshot are all
    // gone together, so the shift can be closed again with its report (P13-D32).
    expect(fake.shift.status).toBe('OPEN')
    expect(fake.reports).toBe(0)
    expect(fake.written).toHaveLength(0)
    expect(fake.shiftClosePayload).toBeNull()
  })

  it('refuses when no shift is open', async () => {
    startCashier()
    const fake = fakeDb()
    const dbWithNoOpenShift = {
      getOptional: async (sql: string, parameters?: unknown[]) =>
        /FROM shift\b/.test(sql) ? null : fake.db.getOptional(sql, parameters),
      getAll: async (sql: string, parameters?: unknown[]) => fake.db.getAll(sql, parameters),
    } as unknown as PowerSyncDatabase

    await expect(
      closeShiftWithReport(dbWithNoOpenShift, {
        countedCashMinor: 0,
        holdsDecision: 'KEEP',
      }),
    ).rejects.toMatchObject({ code: 'NO_OPEN_SHIFT' })
  })

  it('refuses when nobody is signed in', async () => {
    const fake = fakeDb()
    await expect(
      closeShiftWithReport(fake.db, { countedCashMinor: 0, holdsDecision: 'KEEP' }),
    ).rejects.toMatchObject({ code: 'NOT_SIGNED_IN' })
  })
})
