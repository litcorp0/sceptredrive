import type { PowerSyncDatabase } from '@powersync/web'
import { afterEach, describe, expect, it } from 'vitest'
import type { LocalStaffBinding } from '../auth/bindings'
import { endStaffSession, startStaffSession } from '../auth/staff-session'
import { CartVoidError, recordCartVoid } from './void-service'

/**
 * The cart-void write path (P13-D28).
 *
 * The cases pin what makes a void reportable rather than a shrug: a reason is
 * mandatory, `OTHER` needs words, the row carries the item count and the priced
 * gross, and the outbox row — the thing the server validates — is written with
 * the cashier's proof in the same transaction. Voiding a hold also removes it,
 * because a recorded abandonment must not be recallable.
 */

const NOW = new Date('2026-10-27T14:32:00.000Z')

const BINDING: LocalStaffBinding = {
  id: 'binding-1',
  userId: 'user-cashier',
  staffId: 'SD-0003',
  name: 'Ama Mensah',
  role: 'CASHIER',
  bindingId: 'binding-1',
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

const SHIFT = {
  id: 'shift-now',
  number: 'ACC-SPX-T01-S-20261027-01',
  branch_id: 'branch-1',
  terminal_id: 'terminal-1',
  device_id: 'device-1',
  cashier_user_id: BINDING.userId,
  cashier_staff_id: BINDING.staffId,
  status: 'OPEN',
  opened_at: '2026-10-27T08:00:00.000Z',
  closed_at: null,
  opening_float_minor: 20_000,
  counted_cash_minor: null,
  client_expected_cash_minor: null,
  close_note: null,
  opened_by: BINDING.staffId,
  closed_by: null,
  created_at: '2026-10-27T08:00:00.000Z',
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

interface Write {
  sql: string
  parameters: unknown[] | undefined
}

function fakeDb(options: { shift?: typeof SHIFT | null; failOn?: (sql: string) => boolean } = {}) {
  const committed: Write[] = []
  const shift = options.shift === undefined ? SHIFT : options.shift

  async function read(sql: string): Promise<unknown> {
    if (/FROM pos_config/.test(sql)) return CONFIG
    if (/FROM staff_binding/.test(sql)) return BINDING_ROW
    if (/FROM shift/.test(sql)) return shift
    return null
  }
  const db = {
    getOptional: async (sql: string) => read(sql),
    getAll: async () => [],
    async writeTransaction<T>(
      work: (tx: {
        getOptional: (sql: string, parameters?: unknown[]) => Promise<unknown>
        getAll: (sql: string, parameters?: unknown[]) => Promise<unknown[]>
        execute: (sql: string, parameters?: unknown[]) => Promise<unknown>
      }) => Promise<T>,
    ): Promise<T> {
      const pending: Write[] = []
      const tx = {
        getOptional: async (sql: string) => read(sql),
        getAll: async () => [],
        execute: async (sql: string, parameters?: unknown[]) => {
          if (options.failOn?.(sql)) throw new Error('injected write failure')
          pending.push({ sql, parameters })
        },
      }
      const result = await work(tx)
      committed.push(...pending)
      return result
    },
  }

  return { db: db as unknown as PowerSyncDatabase, committed }
}

function startCashier(): void {
  startStaffSession(BINDING)
}

afterEach(() => {
  endStaffSession()
})

const LINES = [
  { productId: 'p-1', name: 'Brake pad set', quantity: 2, unitPriceMinor: 6_000 },
  { productId: 'p-2', name: 'Oil filter', quantity: 1, unitPriceMinor: 2_200 },
]

describe('recordCartVoid', () => {
  it('refuses OTHER without a note and writes nothing', async () => {
    startCashier()
    const { db, committed } = fakeDb()

    await expect(
      recordCartVoid(db, {
        lines: LINES,
        itemCount: 3,
        grossMinor: 14_200,
        reasonCode: 'OTHER',
        note: '  ',
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'NOTE_REQUIRED' })

    expect(committed).toHaveLength(0)
  })

  it('refuses a reason outside the shared vocabulary', async () => {
    startCashier()
    const { db } = fakeDb()

    await expect(
      recordCartVoid(db, {
        lines: LINES,
        itemCount: 3,
        grossMinor: 14_200,
        reasonCode: 'BORED' as never,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(CartVoidError)
  })

  it('writes the row and the CART_VOID outbox row in one transaction', async () => {
    startCashier()
    const { db, committed } = fakeDb()

    const result = await recordCartVoid(db, {
      lines: LINES,
      itemCount: 3,
      grossMinor: 14_200,
      reasonCode: 'CUSTOMER_CHANGED_MIND',
      note: null,
      now: NOW,
    })

    const row = committed.find((write) => write.sql.includes('INSERT INTO cart_void'))
    expect(row).toBeDefined()
    expect(result.voidId).toBe(row?.parameters?.[0])
    // shift_id, reason_code, note, item_count, gross_minor, label, lines
    expect(row?.parameters?.[1]).toBe(SHIFT.id)
    expect(row?.parameters?.[2]).toBe('CUSTOMER_CHANGED_MIND')
    expect(row?.parameters?.[4]).toBe(3)
    expect(row?.parameters?.[5]).toBe(14_200)
    expect(JSON.parse(String(row?.parameters?.[7]))).toEqual(LINES)

    const outbox = committed.find((write) => write.sql.includes('INSERT INTO outbox'))
    expect(outbox?.parameters?.[1]).toBe(result.voidId)
    expect(outbox?.parameters?.[2]).toBe('CART_VOID')
    const payload = JSON.parse(String(outbox?.parameters?.[4])) as {
      shiftId: string
      reasonCode: string
      itemCount: number
      grossMinor: number
      cashier: { bindingToken: string; pinVersion: number }
      lines: unknown[]
      occurredAt: string
    }
    expect(payload).toMatchObject({
      shiftId: SHIFT.id,
      reasonCode: 'CUSTOMER_CHANGED_MIND',
      itemCount: 3,
      grossMinor: 14_200,
      occurredAt: NOW.toISOString(),
    })
    expect(payload.cashier.bindingToken).toBe(BINDING.bindingToken)
    expect(payload.cashier.pinVersion).toBe(BINDING.pinVersion)
    expect(payload.lines).toHaveLength(2)
  })

  it('accepts a note for a coded reason and trims it', async () => {
    startCashier()
    const { db, committed } = fakeDb()

    await recordCartVoid(db, {
      lines: LINES,
      itemCount: 3,
      grossMinor: 14_200,
      reasonCode: 'PRICE_DISPUTE',
      note: '  customer disputed the shelf price  ',
      now: NOW,
    })

    const row = committed.find((write) => write.sql.includes('INSERT INTO cart_void'))
    expect(row?.parameters?.[3]).toBe('customer disputed the shelf price')
  })

  it('voids a held cart with its label and deletes the hold in the same transaction', async () => {
    startCashier()
    const { db, committed } = fakeDb()

    await recordCartVoid(db, {
      lines: LINES,
      itemCount: 3,
      grossMinor: 14_200,
      reasonCode: 'CUSTOMER_LEFT',
      note: 'Voided at shift close: Ama’s brake pads',
      label: 'Ama’s brake pads',
      holdId: 'hold-1',
      now: NOW,
    })

    const row = committed.find((write) => write.sql.includes('INSERT INTO cart_void'))
    expect(row?.parameters?.[6]).toBe('Ama’s brake pads')
    expect(committed.some((write) => write.sql.includes('DELETE FROM held_cart_line'))).toBe(true)
    expect(committed.some((write) => write.sql.includes('DELETE FROM held_cart'))).toBe(true)
  })

  it('refuses without an open shift', async () => {
    startCashier()
    const { db, committed } = fakeDb({ shift: null })

    await expect(
      recordCartVoid(db, {
        lines: LINES,
        itemCount: 3,
        grossMinor: 14_200,
        reasonCode: 'WRONG_ITEM',
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'NO_SHIFT' })
    expect(committed).toHaveLength(0)
  })

  it('rolls the void back when the outbox row cannot be written', async () => {
    startCashier()
    const { db, committed } = fakeDb({
      failOn: (sql) => sql.includes('INSERT INTO outbox'),
    })

    await expect(
      recordCartVoid(db, {
        lines: LINES,
        itemCount: 3,
        grossMinor: 14_200,
        reasonCode: 'DUPLICATE_SCAN',
        now: NOW,
      }),
    ).rejects.toThrow('injected write failure')
    expect(committed).toHaveLength(0)
  })

  it('refuses when nobody is signed in', async () => {
    const { db } = fakeDb()

    await expect(
      recordCartVoid(db, {
        lines: LINES,
        itemCount: 3,
        grossMinor: 14_200,
        reasonCode: 'WRONG_ITEM',
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'NOT_SIGNED_IN' })
  })
})
