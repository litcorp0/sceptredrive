import type { PowerSyncDatabase } from '@powersync/web'
import { afterEach, describe, expect, it } from 'vitest'
import type { LocalStaffBinding } from '../auth/bindings'
import { endStaffSession, startStaffSession } from '../auth/staff-session'
import type { CartState } from '../cart/types'
import { completeSale, prepareSale, SaleCompletionError } from './complete-sale'

/**
 * Sale completion is the atomic boundary: one transaction, no network, no
 * printer. These tests pin the money, the row families, and the rollback
 * behaviour (a failed write must leave nothing behind and burn no receipt
 * number).
 */

const SALE_ID = '55555555-5555-7555-8555-555555555555'
const PRODUCT_A = '11111111-1111-7111-8111-111111111111'
const CUSTOMER_DRAFT = '66666666-6666-7666-8666-666666666666'
const NOW = '2026-10-23T10:15:00.000Z'

const PRICING = {
  taxMode: 'INCLUSIVE' as const,
  loyalty: { pointsPerCedi: 100, earnPointsPerCedi: 1 },
}

const IDENTITY = {
  deviceId: 'device-1',
  terminalId: 'terminal-1',
  terminalCode: 'ACC-SPX-T01',
  branchId: 'branch-1',
  branchCode: 'ACC-SPX',
  branchName: 'Accra - Spintex',
}

const CASHIER = {
  userId: 'user-cashier',
  staffId: 'GA-0003',
  bindingId: '33333333-3333-7333-8333-333333333333',
  bindingToken: 'binding-token-value',
  pinVersion: 2,
}

function cart(overrides: Partial<CartState> = {}): CartState {
  return {
    saleId: SALE_ID,
    shiftId: 'shift-1',
    lines: [
      {
        id: 'line-1',
        productId: PRODUCT_A,
        sku: 'GIK-00001',
        name: 'Brake Pad Set',
        barcode: '4006381333931',
        quantity: 2,
        unitPriceMinor: 6_000,
        taxCategory: 'STANDARD',
        lineDiscountMinor: 0,
        discountReasonCode: null,
        discountNote: null,
        discountOverride: null,
      },
    ],
    saleDiscount: null,
    loyaltyRedeemPoints: 0,
    customer: null,
    creditOverride: null,
    updatedAt: NOW,
    ...overrides,
  }
}

function baseLine(): CartState['lines'][number] {
  const line = cart().lines[0]
  if (!line) throw new Error('fixture has no lines')
  return line
}

function input(overrides: Partial<Parameters<typeof prepareSale>[0]> = {}) {
  return {
    cart: cart(),
    tenders: [{ method: 'CASH' as const, amountMinor: 15_000 }],
    cashier: CASHIER,
    identity: IDENTITY,
    pricing: PRICING,
    appVersion: '0.1.0',
    ...overrides,
  }
}

describe('prepareSale', () => {
  it('prices a cash sale and derives the change', () => {
    const prepared = prepareSale(input(), 'ACC-SPX-T01-20261023-0007', NOW)
    const { sale } = prepared

    expect(sale.totalMinor).toBe(12_000)
    expect(sale.changeMinor).toBe(3_000)
    expect(sale.tenderTotalMinor).toBe(15_000)
    expect(sale.taxTotalMinor).toBe(2_000)
    expect(sale.vatMinor + sale.nhilMinor + sale.getfundMinor).toBe(sale.taxTotalMinor)
    expect(sale.totalMinor).toBe(sale.subtotalMinor - sale.lineDiscountMinor)
    expect(sale.printStatus).toBe('PENDING')
    expect(sale.receiptNumber).toBe('ACC-SPX-T01-20261023-0007')

    expect(prepared.tenders).toEqual([
      {
        saleId: SALE_ID,
        sequence: 1,
        method: 'CASH',
        amountMinor: 15_000,
        reference: null,
        paymentId: null,
        providerReference: null,
        createdAt: NOW,
      },
    ])
    expect(prepared.stockDeltas).toEqual([{ productId: PRODUCT_A, quantityDelta: -2 }])
    expect(prepared.creditDelta).toBeNull()
    expect(prepared.draft.payload.totals.totalMinor).toBe(12_000)
    expect(prepared.draft.payload.totals.changeMinor).toBe(3_000)
  })

  it('keeps duplicate product lines separate but aggregates the stock delta', () => {
    const prepared = prepareSale(
      input({
        cart: cart({
          lines: [
            ...cart().lines,
            {
              ...baseLine(),
              id: 'line-2',
              quantity: 3,
              unitPriceMinor: 6_000,
            },
          ],
        }),
        tenders: [{ method: 'CASH', amountMinor: 40_000 }],
      }),
      'ACC-SPX-T01-20261023-0008',
      NOW,
    )

    expect(prepared.lines).toHaveLength(2)
    expect(prepared.lines[1]?.lineNumber).toBe(2)
    expect(prepared.stockDeltas).toEqual([{ productId: PRODUCT_A, quantityDelta: -5 }])
  })

  it('records a credit tender against the draft customer', () => {
    const prepared = prepareSale(
      input({
        cart: cart({
          customer: {
            customerId: null,
            draftId: CUSTOMER_DRAFT,
            name: 'Ama Boateng',
            phone: '+233201234567',
            isDraft: true,
          },
        }),
        tenders: [{ method: 'CREDIT', amountMinor: 12_000 }],
      }),
      'ACC-SPX-T01-20261023-0009',
      NOW,
    )

    expect(prepared.sale.creditAmountMinor).toBe(12_000)
    expect(prepared.sale.customerId).toBe(CUSTOMER_DRAFT)
    expect(prepared.creditDelta).toEqual({ customerId: CUSTOMER_DRAFT, amountMinor: 12_000 })
    expect(prepared.tenders[0]?.method).toBe('CREDIT')
  })

  it('splits one basket across cash and credit, in payment order', () => {
    const prepared = prepareSale(
      input({
        cart: cart({
          customer: {
            customerId: '77777777-7777-7777-8777-777777777777',
            draftId: null,
            name: 'Akosua Mensah',
            phone: '+233201112222',
            isDraft: false,
          },
        }),
        tenders: [
          { method: 'CASH', amountMinor: 4_000 },
          { method: 'CREDIT', amountMinor: 8_000 },
        ],
      }),
      'ACC-SPX-T01-20261023-0012',
      NOW,
    )

    // GH₵40 at the drawer and GH₵80 on the account, for a GH₵120 basket.
    expect(prepared.sale.totalMinor).toBe(12_000)
    expect(prepared.sale.tenderTotalMinor).toBe(12_000)
    expect(prepared.sale.changeMinor).toBe(0)
    expect(prepared.sale.creditAmountMinor).toBe(8_000)
    expect(prepared.creditDelta).toEqual({
      customerId: '77777777-7777-7777-8777-777777777777',
      amountMinor: 8_000,
    })
    expect(prepared.tenders.map((tender) => [tender.sequence, tender.method])).toEqual([
      [1, 'CASH'],
      [2, 'CREDIT'],
    ])
    expect(prepared.draft.payload.tenders).toEqual([
      {
        method: 'CASH',
        amountMinor: 4_000,
        override: null,
        paymentId: null,
        providerReference: null,
      },
      {
        method: 'CREDIT',
        amountMinor: 8_000,
        override: null,
        paymentId: null,
        providerReference: null,
      },
    ])
  })

  it('lets cash overpay and produces the change from cash alone', () => {
    const prepared = prepareSale(
      input({
        cart: cart({
          customer: {
            customerId: '77777777-7777-7777-8777-777777777777',
            draftId: null,
            name: 'Akosua Mensah',
            phone: '+233201112222',
            isDraft: false,
          },
        }),
        tenders: [
          { method: 'CASH', amountMinor: 10_000 },
          { method: 'CREDIT', amountMinor: 8_000 },
        ],
      }),
      'ACC-SPX-T01-20261023-0013',
      NOW,
    )

    expect(prepared.sale.tenderTotalMinor).toBe(18_000)
    expect(prepared.sale.changeMinor).toBe(6_000)
    expect(prepared.sale.creditAmountMinor).toBe(8_000)
  })

  it('refuses a second credit tender and a credit larger than what is owed', () => {
    const customer = {
      customerId: '77777777-7777-7777-8777-777777777777',
      draftId: null,
      name: 'Akosua Mensah',
      phone: '+233201112222',
      isDraft: false,
    }
    try {
      prepareSale(
        input({
          cart: cart({ customer }),
          tenders: [
            { method: 'CREDIT', amountMinor: 6_000 },
            { method: 'CREDIT', amountMinor: 6_000 },
          ],
        }),
        'X-1',
        NOW,
      )
      throw new Error('expected failure')
    } catch (error) {
      expect((error as SaleCompletionError).code).toBe('INVALID_TENDER')
    }

    expect(() =>
      prepareSale(
        input({ cart: cart({ customer }), tenders: [{ method: 'CREDIT', amountMinor: 12_001 }] }),
        'X-1',
        NOW,
      ),
    ).toThrow(SaleCompletionError)
  })

  it('completes a zero-total sale with no tender', () => {
    const free = {
      ...baseLine(),
      id: 'line-free',
      unitPriceMinor: 0,
      quantity: 1,
    }
    const prepared = prepareSale(
      input({
        cart: cart({ lines: [free] }),
        tenders: [],
      }),
      'ACC-SPX-T01-20261023-0010',
      NOW,
    )

    expect(prepared.sale.totalMinor).toBe(0)
    expect(prepared.tenders).toHaveLength(0)
    expect(prepared.sale.changeMinor).toBe(0)
    expect(prepared.draft.payload.tenders).toHaveLength(0)
  })

  it('records loyalty redemption and the earn preview as pending deltas', () => {
    const prepared = prepareSale(
      input({
        cart: cart({
          customer: {
            customerId: '77777777-7777-7777-8777-777777777777',
            draftId: null,
            name: 'Akosua Mensah',
            phone: '+233201112222',
            isDraft: false,
          },
          loyaltyRedeemPoints: 250,
        }),
        tenders: [{ method: 'CASH', amountMinor: 15_000 }],
      }),
      'ACC-SPX-T01-20261023-0011',
      NOW,
    )

    expect(prepared.sale.loyaltyRedeemPoints).toBe(250)
    expect(prepared.sale.loyaltyDiscountMinor).toBe(250)
    expect(prepared.loyaltyDeltas).toEqual([
      { customerId: '77777777-7777-7777-8777-777777777777', pointsDelta: -250 },
      {
        customerId: '77777777-7777-7777-8777-777777777777',
        pointsDelta: prepared.sale.loyaltyEarnedPoints,
      },
    ])
    expect(prepared.sale.loyaltyEarnedPoints).toBeGreaterThan(0)
  })

  it('refuses cash below the total', () => {
    expect(() =>
      prepareSale(input({ tenders: [{ method: 'CASH', amountMinor: 11_999 }] }), 'X-1', NOW),
    ).toThrow(SaleCompletionError)
    try {
      prepareSale(input({ tenders: [{ method: 'CASH', amountMinor: 11_999 }] }), 'X-1', NOW)
    } catch (error) {
      expect((error as SaleCompletionError).code).toBe('CASH_BELOW_TOTAL')
    }
  })

  it('refuses a credit sale without a customer', () => {
    try {
      prepareSale(input({ tenders: [{ method: 'CREDIT', amountMinor: 12_000 }] }), 'X-1', NOW)
      throw new Error('expected failure')
    } catch (error) {
      expect((error as SaleCompletionError).code).toBe('NO_CUSTOMER_FOR_CREDIT')
    }
  })

  it('refuses a credit tender that is not exactly the total', () => {
    try {
      prepareSale(
        input({
          cart: cart({
            customer: {
              customerId: '77777777-7777-7777-8777-777777777777',
              draftId: null,
              name: 'Akosua',
              phone: '+233201112222',
              isDraft: false,
            },
          }),
          tenders: [{ method: 'CREDIT', amountMinor: 12_001 }],
        }),
        'X-1',
        NOW,
      )
      throw new Error('expected failure')
    } catch (error) {
      expect((error as SaleCompletionError).code).toBe('INVALID_TENDER')
    }
  })
})

const BINDING: LocalStaffBinding = {
  id: 'binding-1',
  userId: CASHIER.userId,
  staffId: CASHIER.staffId,
  name: 'Ama Mensah',
  role: 'CASHIER',
  bindingId: CASHIER.bindingId,
  bindingToken: CASHIER.bindingToken,
  expiresAt: '2099-01-01T00:00:00.000Z',
  pinSalt: 'salt',
  pinVerifier: 'verifier',
  pinVersion: 2,
  pinMustChange: false,
  failedAttempts: 0,
  lockedUntil: null,
  isActive: true,
  boundAt: NOW,
}

const SHIFT_ROW = {
  id: 'shift-1',
  number: 'ACC-SPX-T01-S-20261023-01',
  branch_id: 'branch-1',
  terminal_id: 'terminal-1',
  device_id: 'device-1',
  cashier_user_id: CASHIER.userId,
  cashier_staff_id: CASHIER.staffId,
  status: 'OPEN',
  opened_at: '2026-10-23T08:00:00.000Z',
  closed_at: null,
  opening_float_minor: 20_000,
  counted_cash_minor: null,
  client_expected_cash_minor: null,
  close_note: null,
  opened_by: CASHIER.staffId,
  closed_by: null,
  created_at: '2026-10-23T08:00:00.000Z',
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

interface FakeOptions {
  failOn?: (sql: string) => boolean
  saleExists?: boolean
  lastReceiptValue?: number
  /** The catalogue the completion's inside-transaction check reads. */
  products?: Array<{ id: string; name: string | null; is_active: number }>
}

const PRODUCT_ROW = { id: PRODUCT_A, name: 'Brake Pad Set', is_active: 1 }

function fakeDb(options: FakeOptions = {}) {
  const committed: Array<{ sql: string; parameters: unknown[] | undefined }> = []

  async function read(sql: string): Promise<unknown> {
    if (/FROM shift\b/.test(sql)) return SHIFT_ROW
    if (/FROM staff_binding\b/.test(sql)) return BINDING_ROW
    if (/FROM sale\b/.test(sql)) return options.saleExists ? { id: SALE_ID } : null
    if (/FROM document_sequence\b/.test(sql)) {
      return options.lastReceiptValue === undefined
        ? null
        : { last_value: options.lastReceiptValue }
    }
    return null
  }

  async function readAll(sql: string, parameters?: unknown[]): Promise<unknown[]> {
    if (/FROM product\b/.test(sql)) {
      const ids = (parameters ?? []) as string[]
      return (options.products ?? [PRODUCT_ROW]).filter((row) => ids.includes(row.id))
    }
    return []
  }

  const db = {
    getOptional: async (sql: string) => read(sql),
    getAll: async (sql: string, parameters?: unknown[]) => readAll(sql, parameters),
    async writeTransaction<T>(
      work: (tx: {
        getOptional: (sql: string) => Promise<unknown>
        getAll: (sql: string, parameters?: unknown[]) => Promise<unknown[]>
        execute: (sql: string, parameters?: unknown[]) => Promise<unknown>
      }) => Promise<T>,
    ): Promise<T> {
      const pending: Array<{ sql: string; parameters: unknown[] | undefined }> = []
      const tx = {
        getOptional: async (sql: string) => read(sql),
        getAll: async (sql: string, parameters?: unknown[]) => readAll(sql, parameters),
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

describe('completeSale transaction', () => {
  it('refuses a line whose product is no longer in the catalogue', async () => {
    startCashier()
    const { db, committed } = fakeDb({ products: [] })

    await expect(completeSale(db, { ...input(), now: new Date(NOW) })).rejects.toMatchObject({
      code: 'INVALID_CART',
      message: expect.stringContaining('Brake Pad Set'),
    })
    // Nothing was written and no receipt number was burned.
    expect(committed).toHaveLength(0)
  })

  it('refuses a line whose product was archived', async () => {
    startCashier()
    const { db, committed } = fakeDb({
      products: [{ ...PRODUCT_ROW, is_active: 0 }],
    })

    await expect(completeSale(db, { ...input(), now: new Date(NOW) })).rejects.toMatchObject({
      code: 'INVALID_CART',
      message: expect.stringContaining('archived'),
    })
    expect(committed).toHaveLength(0)
  })

  it('writes every row family in one transaction and allocates the receipt number', async () => {
    startCashier()
    const { db, committed } = fakeDb({ lastReceiptValue: 4 })

    const result = await completeSale(db, {
      ...input(),
      now: new Date(NOW),
    })

    expect(result.receiptNumber).toBe('ACC-SPX-T01-20261023-0005')
    expect(result.saleId).toBe(SALE_ID)
    expect(result.tenders).toEqual([{ method: 'CASH', amountMinor: 15_000 }])

    const sql = committed.map((row) => row.sql)
    expect(sql.some((statement) => statement.includes('INSERT INTO sale ('))).toBe(true)
    expect(sql.some((statement) => statement.includes('INSERT INTO sale_line'))).toBe(true)
    expect(sql.some((statement) => statement.includes('INSERT INTO sale_tender'))).toBe(true)
    expect(sql.some((statement) => statement.includes('INSERT INTO local_stock_delta'))).toBe(true)
    expect(sql.some((statement) => statement.includes('INSERT INTO outbox'))).toBe(true)
    expect(
      sql.some((statement) => statement.includes('INSERT OR REPLACE INTO document_sequence')),
    ).toBe(true)
    expect(sql.some((statement) => statement.includes('DELETE FROM cart_draft'))).toBe(true)

    const outbox = committed.find((row) => row.sql.includes('INSERT INTO outbox'))
    const payload = JSON.parse(String(outbox?.parameters?.[4])) as {
      receiptNumber: string
      totals: { totalMinor: number }
    }
    expect(payload.receiptNumber).toBe('ACC-SPX-T01-20261023-0005')
    expect(payload.totals.totalMinor).toBe(12_000)
  })

  it('writes one sale_tender row per tender, clears the draft tenders, and uploads both', async () => {
    startCashier()
    const { db, committed } = fakeDb({ lastReceiptValue: 4 })

    const result = await completeSale(db, {
      ...input({
        cart: cart({
          customer: {
            customerId: '77777777-7777-7777-8777-777777777777',
            draftId: null,
            name: 'Akosua Mensah',
            phone: '+233201112222',
            isDraft: false,
          },
        }),
        tenders: [
          { method: 'CASH', amountMinor: 4_000 },
          { method: 'CREDIT', amountMinor: 8_000 },
        ],
      }),
      now: new Date(NOW),
    })

    expect(result.tenders).toEqual([
      { method: 'CASH', amountMinor: 4_000 },
      { method: 'CREDIT', amountMinor: 8_000 },
    ])

    const tenderRows = committed.filter((row) => row.sql.includes('INSERT INTO sale_tender'))
    expect(tenderRows).toHaveLength(2)
    expect(tenderRows.map((row) => row.parameters?.[2])).toEqual([1, 2])
    expect(tenderRows.map((row) => row.parameters?.[3])).toEqual(['CASH', 'CREDIT'])
    expect(tenderRows.map((row) => row.parameters?.[4])).toEqual([4_000, 8_000])

    // The in-flight tender set has no meaning once the sale exists (P13-D31).
    expect(committed.some((row) => row.sql === 'DELETE FROM cart_tender WHERE draft_id = ?')).toBe(
      true,
    )

    const outbox = committed.find((row) => row.sql.includes('INSERT INTO outbox'))
    const payload = JSON.parse(String(outbox?.parameters?.[4])) as {
      tenders: Array<{ method: string; amountMinor: number }>
      totals: { changeMinor: number }
    }
    expect(payload.tenders).toEqual([
      {
        method: 'CASH',
        amountMinor: 4_000,
        override: null,
        paymentId: null,
        providerReference: null,
      },
      {
        method: 'CREDIT',
        amountMinor: 8_000,
        override: null,
        paymentId: null,
        providerReference: null,
      },
    ])
    expect(payload.totals.changeMinor).toBe(0)
  })

  it('rolls the whole sale back if any write fails (and burns no number)', async () => {
    startCashier()
    const { db, committed } = fakeDb({
      lastReceiptValue: 4,
      failOn: (sql) => sql.includes('INSERT INTO sale_tender'),
    })

    await expect(completeSale(db, { ...input(), now: new Date(NOW) })).rejects.toThrow(
      'injected write failure',
    )
    expect(committed).toHaveLength(0)
  })

  it('refuses a duplicate sale id before writing anything', async () => {
    startCashier()
    const { db, committed } = fakeDb({ saleExists: true })

    await expect(completeSale(db, { ...input(), now: new Date(NOW) })).rejects.toMatchObject({
      code: 'DUPLICATE_SALE',
    })
    expect(committed).toHaveLength(0)
  })

  it('refuses a stale PIN binding', async () => {
    startCashier()
    const { db } = fakeDb()
    await expect(
      completeSale(db, {
        ...input({ cashier: { ...CASHIER, pinVersion: 9 } }),
        now: new Date(NOW),
      }),
    ).rejects.toMatchObject({ code: 'STALE_BINDING' })
  })

  it('refuses a cart from another shift', async () => {
    startCashier()
    const { db } = fakeDb()
    await expect(
      completeSale(db, {
        ...input({ cart: cart({ shiftId: 'shift-other' }) }),
        now: new Date(NOW),
      }),
    ).rejects.toMatchObject({ code: 'SHIFT_MISMATCH' })
  })
})
