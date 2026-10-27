import type { PowerSyncDatabase } from '@powersync/web'
import { afterEach, describe, expect, it } from 'vitest'
import type { LocalStaffBinding } from '../auth/bindings'
import { endStaffSession, startStaffSession } from '../auth/staff-session'
import type { CartOverrideProof } from '../cart/types'
import {
  createRepayment,
  RepaymentError,
  type RepaymentInput,
  readCreditAccount,
} from './repayment-service'

/**
 * Taking a debt down at the till (Plan 10 Task 7).
 *
 * The two facts this pins: the delta is **negative** and signed into the same
 * headroom sum the sale path uses, and MoMo is only accepted once the server
 * says the payment is `PAID`.
 */

const NOW = new Date('2026-10-27T10:30:00.000Z')
const CUSTOMER_ID = '77777777-7777-7777-8777-777777777777'

const BINDING: LocalStaffBinding = {
  id: '33333333-3333-7333-8333-333333333333',
  userId: 'user-cashier',
  staffId: 'GA-0003',
  name: 'Ama Mensah',
  role: 'CASHIER',
  bindingId: '33333333-3333-7333-8333-333333333333',
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

const OVERRIDE: CartOverrideProof = {
  approverUserId: 'user-manager',
  approverStaffId: 'GA-0002',
  approverRole: 'MANAGER',
  bindingId: '22222222-2222-7222-8222-222222222222',
  pinVersion: 3,
  reasonCode: 'CUSTOMER_REQUEST',
  note: null,
  approvedAt: '2026-10-27T10:29:00.000Z',
}

const CONFIG_ROW = {
  terminal_id: 'terminal-1',
  terminal_code: 'ACC-SPX-T01',
  branch_id: 'branch-1',
}

const SHIFT_ROW = {
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
  pin_salt: 'salt',
  pin_verifier: 'verifier',
  pin_version: BINDING.pinVersion,
  pin_must_change: 0,
  failed_attempts: 0,
  locked_until: null,
  is_active: 1,
  bound_at: BINDING.boundAt,
}

interface HarnessOptions {
  hold?: boolean
  pendingMinor?: number
}

function fakeDb(options: HarnessOptions = {}) {
  const committed: Array<{ sql: string; parameters: unknown[] | undefined }> = []

  async function read(sql: string): Promise<unknown> {
    if (/FROM pos_config\b/.test(sql)) return CONFIG_ROW
    if (/FROM staff_binding\b/.test(sql)) return BINDING_ROW
    if (/FROM shift\b/.test(sql)) return SHIFT_ROW
    if (/FROM customer\b/.test(sql)) {
      return { id: CUSTOMER_ID, name: 'Akosua Mensah', phone: '+233201112222' }
    }
    if (/FROM credit_profile\b/.test(sql)) {
      return { limit_minor: 100_000, balance_minor: 40_000, hold: options.hold ? 1 : 0 }
    }
    if (/FROM local_credit_delta\b/.test(sql)) return { total: options.pendingMinor ?? 0 }
    if (/FROM document_sequence\b/.test(sql)) return null
    return null
  }

  const db = {
    getOptional: async (sql: string) => read(sql),
    getAll: async (sql: string) => {
      const value = await read(sql)
      return Array.isArray(value) ? value : []
    },
    async writeTransaction<T>(
      work: (tx: {
        getOptional: (sql: string, parameters?: unknown[]) => Promise<unknown>
        getAll: (sql: string, parameters?: unknown[]) => Promise<unknown[]>
        execute: (sql: string, parameters?: unknown[]) => Promise<unknown>
      }) => Promise<T>,
    ): Promise<T> {
      const pending: Array<{ sql: string; parameters: unknown[] | undefined }> = []
      const tx = {
        getOptional: async (sql: string) => read(sql),
        getAll: async (sql: string) => {
          const value = await read(sql)
          return Array.isArray(value) ? value : []
        },
        execute: async (sql: string, parameters?: unknown[]) => {
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

function input(overrides: Partial<RepaymentInput> = {}): RepaymentInput {
  return {
    customerId: CUSTOMER_ID,
    amountMinor: 5_000,
    method: 'CASH',
    payment: null,
    note: null,
    override: null,
    ...overrides,
  }
}

afterEach(() => {
  endStaffSession()
})

describe('readCreditAccount', () => {
  it('sums signed deltas so a repayment raises headroom before it syncs', async () => {
    const { db } = fakeDb({ pendingMinor: -5_000 })
    const account = await readCreditAccount(db, CUSTOMER_ID, 'branch-1')

    expect(account?.snapshot.balanceMinor).toBe(40_000)
    expect(account?.snapshot.pendingMinor).toBe(-5_000)
    expect(account?.projectedBalanceMinor).toBe(35_000)
    expect(account?.headroomMinor).toBe(65_000)
  })
})

describe('createRepayment', () => {
  it('writes a negative credit delta and a CREDIT_REPAYMENT outbox row', async () => {
    startStaffSession(BINDING)
    const { db, committed } = fakeDb()

    const result = await createRepayment(db, input(), { now: NOW })

    expect(result.number).toBe('RP-ACC-SPX-T01-20261027-0001')
    expect(result.amountMinor).toBe(5_000)
    expect(result.projectedBalanceMinor).toBe(35_000)
    expect(result.headroomMinor).toBe(65_000)

    const delta = committed.find((row) => row.sql.includes('INSERT INTO local_credit_delta'))
    expect(delta?.parameters?.[2]).toBe(CUSTOMER_ID)
    expect(delta?.parameters?.[3]).toBe(-5_000)
    expect(delta?.parameters?.[4]).toBeNull()

    const outbox = committed.find((row) => row.sql.includes('INSERT INTO outbox'))
    expect(outbox?.parameters?.[1]).toBe(result.repaymentId)
    expect(outbox?.parameters?.[2]).toBe('CREDIT_REPAYMENT')
    const payload = JSON.parse(String(outbox?.parameters?.[4])) as {
      customerId: string
      amountMinor: number
      method: string
      paymentId: string | null
      number: string
    }
    expect(payload).toMatchObject({
      customerId: CUSTOMER_ID,
      amountMinor: 5_000,
      method: 'CASH',
      paymentId: null,
      number: result.number,
    })
  })

  it('refuses a MoMo repayment whose payment has not settled', async () => {
    startStaffSession(BINDING)
    const { db, committed } = fakeDb()

    await expect(
      createRepayment(
        db,
        input({
          method: 'MOMO',
          payment: { id: 'payment-1', status: 'PENDING', method: 'MOMO', amountMinor: 5_000 },
        }),
        { now: NOW },
      ),
    ).rejects.toMatchObject({ code: 'PAYMENT_NOT_PAID' })
    expect(committed).toHaveLength(0)
  })

  it('accepts a PAID MoMo payment and cites it', async () => {
    startStaffSession(BINDING)
    const { db, committed } = fakeDb()

    await createRepayment(
      db,
      input({
        method: 'MOMO',
        payment: { id: 'payment-1', status: 'PAID', method: 'MOMO', amountMinor: 5_000 },
      }),
      { now: NOW },
    )

    const outbox = committed.find((row) => row.sql.includes('INSERT INTO outbox'))
    const payload = JSON.parse(String(outbox?.parameters?.[4])) as { paymentId: string }
    expect(payload.paymentId).toBe('payment-1')
  })

  it('refuses a payment whose amount is not this repayment', async () => {
    startStaffSession(BINDING)
    const { db } = fakeDb()

    await expect(
      createRepayment(
        db,
        input({
          method: 'MOMO',
          payment: { id: 'payment-1', status: 'PAID', method: 'MOMO', amountMinor: 6_000 },
        }),
        { now: NOW },
      ),
    ).rejects.toBeInstanceOf(RepaymentError)
  })

  it('refuses money against a held account without a manager', async () => {
    startStaffSession(BINDING)
    const { db, committed } = fakeDb({ hold: true })

    await expect(createRepayment(db, input(), { now: NOW })).rejects.toMatchObject({
      code: 'ACCOUNT_ON_HOLD',
    })
    expect(committed).toHaveLength(0)
  })

  it('takes a held account’s repayment with a manager override', async () => {
    startStaffSession(BINDING)
    const { db, committed } = fakeDb({ hold: true })

    await createRepayment(db, input({ override: OVERRIDE }), { now: NOW })

    const outbox = committed.find((row) => row.sql.includes('INSERT INTO outbox'))
    const payload = JSON.parse(String(outbox?.parameters?.[4])) as {
      override: { userId: string; reasonCode: string }
    }
    expect(payload.override).toMatchObject({
      userId: OVERRIDE.approverUserId,
      reasonCode: OVERRIDE.reasonCode,
    })
  })
})
