import type { PowerSyncDatabase } from '@powersync/web'
import { afterEach, describe, expect, it } from 'vitest'
import type { LocalStaffBinding } from '../auth/bindings'
import { endStaffSession, startStaffSession } from '../auth/staff-session'
import type { CartOverrideProof } from '../cart/types'
import { priceRefundLines, refundableLineQuantity } from './refund-pricing'
import { createRefund, type RefundInput } from './refund-service'
import { RefundError, type RefundSource } from './refund-types'

/**
 * The refund write path (Plan 10 Task 7).
 *
 * These cases pin the money and the atomic boundary: a third unit of a two-unit
 * line is refused, a full-line refund equals the line's stored figures, the
 * `RF-…` number is consumed inside the transaction, and only `RESALABLE` goods
 * move stock. The outbox row is asserted as a shape, because that payload is
 * what the server validates.
 */

const NOW = new Date('2026-10-27T10:15:00.000Z')
const SALE_ID = '55555555-5555-7555-8555-555555555555'
const PRODUCT_A = '11111111-1111-7111-8111-111111111111'
const LINE_A = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa'
const TENDER_CASH = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb'
const TENDER_MOMO = 'cccccccc-cccc-7ccc-8ccc-cccccccccccc'

const CASHIER = {
  userId: 'user-cashier',
  staffId: 'SD-0003',
  bindingId: '33333333-3333-7333-8333-333333333333',
  bindingToken: 'cashier-token',
  pinVersion: 2,
}

const MANAGER_PROOF: CartOverrideProof = {
  approverUserId: 'user-manager',
  approverStaffId: 'SD-0002',
  approverRole: 'MANAGER',
  bindingId: '22222222-2222-7222-8222-222222222222',
  pinVersion: 3,
  reasonCode: 'DEFECTIVE',
  note: null,
  approvedAt: '2026-10-27T10:14:00.000Z',
}

const BINDING_ROW = {
  id: CASHIER.bindingId,
  user_id: CASHIER.userId,
  staff_id: CASHIER.staffId,
  name: 'Ama Mensah',
  role: 'CASHIER',
  binding_id: CASHIER.bindingId,
  binding_token: CASHIER.bindingToken,
  expires_at: '2099-01-01T00:00:00.000Z',
  pin_salt: 'salt',
  pin_verifier: 'verifier',
  pin_version: CASHIER.pinVersion,
  pin_must_change: 0,
  failed_attempts: 0,
  locked_until: null,
  is_active: 1,
  bound_at: '2026-10-01T00:00:00.000Z',
}

const CASHIER_BINDING: LocalStaffBinding = {
  id: BINDING_ROW.id,
  userId: CASHIER.userId,
  staffId: CASHIER.staffId,
  name: 'Ama Mensah',
  role: 'CASHIER',
  bindingId: CASHIER.bindingId,
  bindingToken: CASHIER.bindingToken,
  expiresAt: BINDING_ROW.expires_at,
  pinSalt: 'salt',
  pinVerifier: 'verifier',
  pinVersion: CASHIER.pinVersion,
  pinMustChange: false,
  failedAttempts: 0,
  lockedUntil: null,
  isActive: true,
  boundAt: BINDING_ROW.bound_at,
}

const MANAGER_BINDING: LocalStaffBinding = {
  ...CASHIER_BINDING,
  id: MANAGER_PROOF.bindingId,
  userId: MANAGER_PROOF.approverUserId,
  staffId: MANAGER_PROOF.approverStaffId,
  name: 'Efua Owusu',
  role: 'MANAGER',
  bindingId: MANAGER_PROOF.bindingId,
  bindingToken: 'manager-token',
  pinVersion: MANAGER_PROOF.pinVersion,
}

function startCashier(): void {
  startStaffSession(CASHIER_BINDING)
}

function startManager(): void {
  startStaffSession(MANAGER_BINDING)
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
  cashier_user_id: CASHIER.userId,
  cashier_staff_id: CASHIER.staffId,
  status: 'OPEN',
  opened_at: '2026-10-27T08:00:00.000Z',
  closed_at: null,
  opening_float_minor: 20_000,
  counted_cash_minor: null,
  client_expected_cash_minor: null,
  close_note: null,
  opened_by: CASHIER.staffId,
  closed_by: null,
  created_at: '2026-10-27T08:00:00.000Z',
}

const SALE_ROW = {
  id: SALE_ID,
  receipt_number: 'ACC-SPX-T01-20261027-0007',
  terminal_id: 'terminal-1',
  shift_id: 'shift-old',
  occurred_at: '2026-10-27T09:00:00.000Z',
  total_minor: 12_000,
  tender_total_minor: 15_000,
  change_minor: 3_000,
  tax_mode: 'INCLUSIVE',
  customer_id: null,
  customer_name: null,
}

const LINE_ROW = {
  id: LINE_A,
  line_number: 1,
  product_id: PRODUCT_A,
  name: 'Brake Pad Set',
  quantity: 2,
  unit_price_minor: 6_000,
  tax_category: 'STANDARD',
  base_minor: 10_000,
  vat_minor: 1_500,
  nhil_minor: 250,
  getfund_minor: 250,
  tax_total_minor: 2_000,
  total_minor: 12_000,
}

const CASH_TENDER_ROW = {
  id: TENDER_CASH,
  sequence: 1,
  method: 'CASH',
  amount_minor: 15_000,
  payment_id: null,
}

function source(overrides: Partial<RefundSource> = {}): RefundSource {
  return {
    saleId: SALE_ID,
    receiptNumber: SALE_ROW.receipt_number,
    terminalId: 'terminal-1',
    shiftId: 'shift-old',
    occurredAt: SALE_ROW.occurred_at,
    taxMode: 'INCLUSIVE',
    customerName: null,
    totalMinor: 12_000,
    tenderTotalMinor: 15_000,
    changeMinor: 3_000,
    previouslyRefundedMinor: 0,
    lines: [
      {
        saleLineId: LINE_A,
        lineNumber: 1,
        productId: PRODUCT_A,
        name: 'Brake Pad Set',
        quantity: 2,
        unitPriceMinor: 6_000,
        taxCategory: 'STANDARD',
        baseMinor: 10_000,
        vatMinor: 1_500,
        nhilMinor: 250,
        getfundMinor: 250,
        taxTotalMinor: 2_000,
        totalMinor: 12_000,
        priorRefundQuantities: [],
      },
    ],
    tenders: [
      {
        saleTenderId: TENDER_CASH,
        sequence: 1,
        method: 'CASH',
        amountMinor: 15_000,
        paymentId: null,
        alreadyRefundedMinor: 0,
        refundableMinor: 12_000,
      },
    ],
    ...overrides,
  }
}

function input(overrides: Partial<RefundInput> = {}): RefundInput {
  return {
    saleId: SALE_ID,
    lines: [{ saleLineId: LINE_A, quantity: 2, restock: 'RESALABLE' }],
    tenders: [{ saleTenderId: TENDER_CASH, amountMinor: 12_000 }],
    reasonCode: 'DEFECTIVE',
    note: null,
    approval: MANAGER_PROOF,
    ...overrides,
  }
}

interface FakeOptions {
  failOn?: (sql: string) => boolean
  lastRefundValue?: number
  sale?: typeof SALE_ROW | null
  lineRows?: unknown[]
  priorLines?: unknown[]
  tenderRows?: unknown[]
  tenderTotals?: unknown[]
  previouslyRefunded?: number
}

function fakeDb(options: FakeOptions = {}) {
  const committed: Array<{ sql: string; parameters: unknown[] | undefined }> = []

  async function read(sql: string): Promise<unknown> {
    if (/FROM pos_config\b/.test(sql)) return CONFIG_ROW
    if (/FROM staff_binding\b/.test(sql)) return BINDING_ROW
    if (/FROM shift\b/.test(sql)) return SHIFT_ROW
    if (/FROM sale s\b/.test(sql)) return options.sale === undefined ? SALE_ROW : options.sale
    if (/FROM refund_line\b/.test(sql)) return options.priorLines ?? []
    if (/FROM sale_line\b/.test(sql)) return options.lineRows ?? [LINE_ROW]
    if (/FROM sale_tender\b/.test(sql)) return options.tenderRows ?? [CASH_TENDER_ROW]
    if (/FROM refund_tender\b/.test(sql)) return options.tenderTotals ?? []
    if (/FROM refund WHERE/.test(sql)) return { total: options.previouslyRefunded ?? 0 }
    if (/FROM document_sequence\b/.test(sql)) {
      return options.lastRefundValue === undefined ? null : { last_value: options.lastRefundValue }
    }
    return null
  }

  async function readAll(sql: string): Promise<unknown[]> {
    const value = await read(sql)
    return Array.isArray(value) ? value : []
  }

  const db = {
    getOptional: async (sql: string) => read(sql),
    getAll: async (sql: string) => readAll(sql),
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
        getAll: async (sql: string) => readAll(sql),
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

afterEach(() => {
  endStaffSession()
})

describe('priceRefundLines', () => {
  it('refuses a third unit of a two-unit line', () => {
    expect(refundableLineQuantity(source().lines[0] as RefundSource['lines'][number])).toBe(2)
    expect(() =>
      priceRefundLines(source(), [{ saleLineId: LINE_A, quantity: 3, restock: 'RESALABLE' }]),
    ).toThrow(RefundError)
    try {
      priceRefundLines(source(), [{ saleLineId: LINE_A, quantity: 3, restock: 'RESALABLE' }])
    } catch (error) {
      expect((error as RefundError).code).toBe('EXCEEDS_LINE')
    }
  })

  it('values a full-line refund as exactly the line’s stored figures', () => {
    const pricing = priceRefundLines(source(), [
      { saleLineId: LINE_A, quantity: 2, restock: 'NOT_RETURNED' },
    ])
    expect(pricing.totals).toEqual({
      baseMinor: 10_000,
      vatMinor: 1_500,
      nhilMinor: 250,
      getfundMinor: 250,
      taxTotalMinor: 2_000,
      totalMinor: 12_000,
    })
    expect(pricing.refundedMinor).toBe(12_000)
  })

  it('telescopes 1 of 2 then 1 of 2 to the same total', () => {
    const pricing = priceRefundLines(
      source({
        lines: [
          {
            ...(source().lines[0] as RefundSource['lines'][number]),
            priorRefundQuantities: [1],
          },
        ],
      }),
      [{ saleLineId: LINE_A, quantity: 1, restock: 'DAMAGED', damageReason: 'Cracked' }],
    )
    expect(pricing.refundedMinor).toBe(6_000)
  })

  it('insists on a damage reason and refuses one elsewhere', () => {
    try {
      priceRefundLines(source(), [{ saleLineId: LINE_A, quantity: 1, restock: 'DAMAGED' }])
      throw new Error('expected failure')
    } catch (error) {
      expect((error as RefundError).code).toBe('DAMAGE_REASON_REQUIRED')
    }
    try {
      priceRefundLines(source(), [
        { saleLineId: LINE_A, quantity: 1, restock: 'RESALABLE', damageReason: 'Cracked' },
      ])
      throw new Error('expected failure')
    } catch (error) {
      expect((error as RefundError).code).toBe('DAMAGE_REASON_NOT_ALLOWED')
    }
  })
})

describe('createRefund', () => {
  it('writes the number, the documents, the stock delta and the outbox row atomically', async () => {
    startCashier()
    const { db, committed } = fakeDb({ lastRefundValue: 6 })

    const result = await createRefund(db, input(), { now: NOW })

    expect(result.number).toBe('RF-ACC-SPX-T01-20261027-0007')
    expect(result.refundedMinor).toBe(12_000)

    const sql = committed.map((row) => row.sql)
    // The number is consumed inside the transaction, before the document.
    const sequenceIndex = sql.findIndex((statement) =>
      statement.includes('INSERT OR REPLACE INTO document_sequence'),
    )
    const refundIndex = sql.findIndex((statement) => statement.includes('INSERT INTO refund ('))
    expect(sequenceIndex).toBeGreaterThan(-1)
    expect(refundIndex).toBeGreaterThan(sequenceIndex)

    expect(sql.some((statement) => statement.includes('INSERT INTO refund_line'))).toBe(true)
    expect(sql.some((statement) => statement.includes('INSERT INTO refund_tender'))).toBe(true)
    expect(sql.some((statement) => statement.includes('INSERT INTO local_stock_delta'))).toBe(true)

    const outbox = committed.find((row) => row.sql.includes('INSERT INTO outbox'))
    expect(outbox?.parameters?.[1]).toBe(result.refundId)
    expect(outbox?.parameters?.[2]).toBe('REFUND')
    const payload = JSON.parse(String(outbox?.parameters?.[4])) as {
      saleId: string
      number: string
      refundedMinor: number
      tenders: Array<{ saleTenderId: string; amountMinor: number }>
      lines: Array<{ saleLineId: string; quantity: number; restock: string }>
    }
    expect(payload.saleId).toBe(SALE_ID)
    expect(payload.number).toBe(result.number)
    expect(payload.refundedMinor).toBe(12_000)
    expect(payload.tenders).toEqual([{ saleTenderId: TENDER_CASH, amountMinor: 12_000 }])
    expect(payload.lines).toEqual([
      { saleLineId: LINE_A, quantity: 2, restock: 'RESALABLE', damageReason: null },
    ])
  })

  it('rolls the whole refund back and burns no number', async () => {
    startCashier()
    const { db, committed } = fakeDb({
      lastRefundValue: 6,
      failOn: (statement) => statement.includes('INSERT INTO refund_tender'),
    })

    await expect(createRefund(db, input(), { now: NOW })).rejects.toThrow('injected write failure')
    expect(committed).toHaveLength(0)
  })

  it('writes no stock delta for a damaged line', async () => {
    startCashier()
    const { db, committed } = fakeDb()

    await createRefund(
      db,
      input({
        lines: [
          { saleLineId: LINE_A, quantity: 2, restock: 'DAMAGED', damageReason: 'Both cracked' },
        ],
      }),
      { now: NOW },
    )

    expect(committed.some((row) => row.sql.includes('INSERT INTO local_stock_delta'))).toBe(false)
    const refundLine = committed.find((row) => row.sql.includes('INSERT INTO refund_line'))
    expect(refundLine?.parameters?.[4]).toBe('DAMAGED')
    expect(refundLine?.parameters?.[5]).toBe('Both cracked')
  })

  it('refuses tenders that do not add up to the lines', async () => {
    startCashier()
    const { db, committed } = fakeDb()

    await expect(
      createRefund(db, input({ tenders: [{ saleTenderId: TENDER_CASH, amountMinor: 11_999 }] }), {
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'SUM_MISMATCH' })
    expect(committed).toHaveLength(0)
  })

  it('refuses a tender beyond the sale’s kept money', async () => {
    startCashier()
    const { db } = fakeDb()

    await expect(
      createRefund(db, input({ tenders: [{ saleTenderId: TENDER_CASH, amountMinor: 12_001 }] }), {
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'EXCEEDS_TENDER' })
  })

  it('marks an electronic tender pending and never settles it locally', async () => {
    startCashier()
    const { db, committed } = fakeDb({
      tenderRows: [
        CASH_TENDER_ROW,
        {
          id: TENDER_MOMO,
          sequence: 2,
          method: 'MOMO',
          amount_minor: 12_000,
          payment_id: 'payment-1',
        },
      ],
    })

    const result = await createRefund(
      db,
      input({
        tenders: [
          { saleTenderId: TENDER_CASH, amountMinor: 6_000 },
          { saleTenderId: TENDER_MOMO, amountMinor: 6_000 },
        ],
      }),
      { now: NOW },
    )

    expect(result.tenders.map((tender) => [tender.method, tender.status])).toEqual([
      ['CASH', 'SETTLED'],
      ['MOMO', 'PENDING'],
    ])
    const electronic = committed.find(
      (row) => row.sql.includes('INSERT INTO refund_tender') && row.parameters?.[3] === 'MOMO',
    )
    expect(electronic?.parameters?.[7]).toBe('PENDING')
    expect(electronic?.parameters?.[6]).toBe('payment-1')
  })

  it('refuses a manager approving their own refund', async () => {
    startManager()
    const { db } = fakeDb()

    await expect(
      createRefund(
        db,
        input({
          approval: {
            ...MANAGER_PROOF,
            approverUserId: 'user-manager',
            approverStaffId: 'SD-0002',
          },
        }),
        { now: NOW },
      ),
    ).rejects.toMatchObject({ code: 'SELF_APPROVAL' })
  })

  it('refuses a refund against another terminal’s sale', async () => {
    startCashier()
    const { db } = fakeDb({ sale: { ...SALE_ROW, terminal_id: 'terminal-2' } })

    await expect(createRefund(db, input(), { now: NOW })).rejects.toMatchObject({
      code: 'FOREIGN_SALE',
    })
  })
})
