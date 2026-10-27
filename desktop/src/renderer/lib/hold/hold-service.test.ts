import type { PowerSyncDatabase } from '@powersync/web'
import type { TaxCategory, TaxMode } from '@sceptre/shared'
import { afterEach, describe, expect, it } from 'vitest'
import type { LocalStaffBinding } from '../auth/bindings'
import { endStaffSession, startStaffSession } from '../auth/staff-session'
import { loadCartDraft } from '../cart/cart-repository'
import { computeCartTotals } from '../cart/totals'
import type { CartLine } from '../cart/types'
import {
  countHeldCarts,
  type HoldableCart,
  HoldError,
  holdCart,
  listHeldCarts,
  nextCartLabel,
  recallHeldCart,
  staffInitials,
} from './hold-service'

/**
 * Hold lifecycle (P13-D29, P13-D35).
 *
 * The cases prove the four promises the till makes: a hold is refused when it
 * cannot be stored (empty, unnamed, eleven); a recall re-prices and **deletes**
 * the hold in the same transaction that writes the draft, so it cannot be served
 * twice; a basket already on screen is parked rather than destroyed; and a
 * missing or archived product blocks completion instead of quietly selling it.
 */

const NOW = new Date('2026-10-27T10:15:00.000Z')

const BINDING: LocalStaffBinding = {
  id: 'binding-1',
  userId: 'user-cashier',
  staffId: 'GA-0003',
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
  branch_id: 'branch-1',
  tax_mode: 'INCLUSIVE',
  config_json: JSON.stringify({
    loyalty: { pointsPerCedi: 100, earnPointsPerCedi: 1 },
  }),
}

const CATALOGUE = [
  {
    product_id: 'p-pad',
    name: 'Brake pad set',
    sku: 'BP-1',
    unit_price_minor: 12_000,
    tax_category: 'STANDARD',
    is_active: 1,
  },
  {
    product_id: 'p-oil',
    name: 'Oil filter',
    sku: 'OF-1',
    unit_price_minor: 2_200,
    tax_category: 'STANDARD',
    is_active: 1,
  },
]

interface HeldCartRow {
  id: string
  label: string
  held_at: string
  held_by_user_id: string
  held_by_staff_id: string
  shift_id: string | null
  customer_id: string | null
  customer_name: string | null
  customer_phone: string | null
  loyalty_redeem_points: number
  sale_discount_minor: number
  sale_discount_reason: string | null
  sale_discount_note: string | null
  sale_discount_override: string | null
  subtotal_minor: number
  total_minor: number
  item_count: number
}

interface HeldLineRow {
  hold_id: string
  line_number: number
  product_id: string
  sku: string
  name: string
  barcode: string | null
  quantity: number
  unit_price_minor: number
  tax_category: string
  line_discount_minor: number
  line_discount_reason: string | null
  line_discount_note: string | null
  line_discount_override: string | null
}

interface FakeState {
  holds: HeldCartRow[]
  lines: HeldLineRow[]
  catalogue: typeof CATALOGUE
  loyalty: Record<string, number>
  drafts: Array<{ id: string; name: string; phone: string }>
}

interface Write {
  sql: string
  parameters: unknown[] | undefined
}

function holdRow(id: string, label: string, overrides: Partial<HeldCartRow> = {}): HeldCartRow {
  return {
    id,
    label,
    held_at: '2026-10-27T09:00:00.000Z',
    held_by_user_id: BINDING.userId,
    held_by_staff_id: BINDING.staffId,
    shift_id: 'shift-now',
    customer_id: null,
    customer_name: null,
    customer_phone: null,
    loyalty_redeem_points: 0,
    sale_discount_minor: 0,
    sale_discount_reason: null,
    sale_discount_note: null,
    sale_discount_override: null,
    subtotal_minor: 12_000,
    total_minor: 12_000,
    item_count: 1,
    ...overrides,
  }
}

function holdLineRow(holdId: string, overrides: Partial<HeldLineRow> = {}): HeldLineRow {
  return {
    hold_id: holdId,
    line_number: 1,
    product_id: 'p-pad',
    sku: 'BP-1',
    name: 'Brake pad set',
    barcode: null,
    quantity: 1,
    unit_price_minor: 12_000,
    tax_category: 'STANDARD',
    line_discount_minor: 0,
    line_discount_reason: null,
    line_discount_note: null,
    line_discount_override: null,
    ...overrides,
  }
}

function applyWrite(state: FakeState, write: Write): void {
  const { sql, parameters } = write
  if (sql.includes('INSERT INTO held_cart ') || sql.includes('INSERT INTO held_cart (')) {
    const p = parameters ?? []
    state.holds.push({
      id: String(p[0]),
      label: String(p[1]),
      held_at: String(p[2]),
      held_by_user_id: String(p[3]),
      held_by_staff_id: String(p[4]),
      shift_id: (p[5] as string | null) ?? null,
      customer_id: (p[6] as string | null) ?? null,
      customer_name: (p[7] as string | null) ?? null,
      customer_phone: (p[8] as string | null) ?? null,
      loyalty_redeem_points: Number(p[9]),
      sale_discount_minor: Number(p[10]),
      sale_discount_reason: (p[11] as string | null) ?? null,
      sale_discount_note: (p[12] as string | null) ?? null,
      sale_discount_override: (p[13] as string | null) ?? null,
      subtotal_minor: Number(p[14]),
      total_minor: Number(p[15]),
      item_count: Number(p[16]),
    })
    return
  }
  if (sql.includes('INSERT INTO held_cart_line')) {
    const p = parameters ?? []
    state.lines.push({
      hold_id: String(p[1]),
      line_number: Number(p[2]),
      product_id: String(p[3]),
      sku: String(p[4]),
      name: String(p[5]),
      barcode: (p[6] as string | null) ?? null,
      quantity: Number(p[7]),
      unit_price_minor: Number(p[8]),
      tax_category: String(p[9]),
      line_discount_minor: Number(p[10]),
      line_discount_reason: (p[11] as string | null) ?? null,
      line_discount_note: (p[12] as string | null) ?? null,
      line_discount_override: (p[13] as string | null) ?? null,
    })
    return
  }
  if (sql.includes('DELETE FROM held_cart_line WHERE hold_id')) {
    state.lines = state.lines.filter((line) => line.hold_id !== parameters?.[0])
    return
  }
  if (sql.includes('DELETE FROM held_cart WHERE id')) {
    state.holds = state.holds.filter((hold) => hold.id !== parameters?.[0])
  }
}

function fakeDb(
  options: {
    state?: Partial<FakeState>
    failOn?: (sql: string) => boolean
    reads?: Array<{ match: RegExp; rows: unknown[] }>
  } = {},
) {
  const state: FakeState = {
    holds: [],
    lines: [],
    catalogue: CATALOGUE,
    loyalty: {},
    drafts: [],
    ...options.state,
  }
  const written: Write[] = []

  async function readOne(sql: string, parameters?: unknown[]): Promise<unknown> {
    for (const extra of options.reads ?? []) {
      if (extra.match.test(sql)) return extra.rows[0] ?? null
    }
    if (/FROM pos_config/.test(sql)) return CONFIG
    if (/COUNT\(\*\) AS total FROM held_cart/.test(sql)) {
      return { total: state.holds.length }
    }
    if (/FROM held_cart hc/.test(sql)) {
      return [...state.holds]
        .sort((left, right) => left.held_at.localeCompare(right.held_at))
        .map((hold) => ({
          id: hold.id,
          label: hold.label,
          held_at: hold.held_at,
          held_by_user_id: hold.held_by_user_id,
          held_by_staff_id: hold.held_by_staff_id,
          held_by_name: BINDING.name,
          customer_name: hold.customer_name,
          item_count: hold.item_count,
          total_minor: hold.total_minor,
        }))
    }
    if (/FROM held_cart WHERE id/.test(sql)) {
      return state.holds.find((hold) => hold.id === parameters?.[0]) ?? null
    }
    if (/FROM product p/.test(sql)) return state.catalogue
    if (/FROM loyalty_account/.test(sql)) {
      const customerId = String(parameters?.[0])
      return { balance_points: state.loyalty[customerId] ?? 0 }
    }
    if (/FROM customer_draft/.test(sql)) {
      return state.drafts.find((draft) => draft.phone === parameters?.[0]) ?? null
    }
    return null
  }

  async function readAll(sql: string, parameters?: unknown[]): Promise<unknown[]> {
    const one = await readOne(sql, parameters)
    if (Array.isArray(one)) return one
    if (/FROM held_cart_line/.test(sql)) {
      return state.lines
        .filter((line) => line.hold_id === parameters?.[0])
        .sort((left, right) => left.line_number - right.line_number)
    }
    if (/SELECT label FROM held_cart/.test(sql))
      return state.holds.map((hold) => ({ label: hold.label }))
    if (/FROM local_loyalty_delta/.test(sql)) return []
    if (/FROM cart_draft/.test(sql)) return []
    return one ? [one] : []
  }

  const db = {
    getOptional: async (sql: string, parameters?: unknown[]) => readOne(sql, parameters),
    getAll: async (sql: string, parameters?: unknown[]) => readAll(sql, parameters),
    execute: async (sql: string, parameters?: unknown[]) => {
      written.push({ sql, parameters })
      return undefined
    },
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
      for (const write of pending) applyWrite(state, write)
      return result
    },
  }

  return { db: db as unknown as PowerSyncDatabase, state, written }
}

const PRICING = {
  taxMode: 'INCLUSIVE' as TaxMode,
  loyalty: { pointsPerCedi: 100, earnPointsPerCedi: 1 },
}

function line(overrides: Partial<CartLine> = {}): CartLine {
  return {
    id: 'line-1',
    productId: 'p-pad',
    sku: 'BP-1',
    name: 'Brake pad set',
    barcode: null,
    quantity: 1,
    unitPriceMinor: 12_000,
    taxCategory: 'STANDARD' as TaxCategory,
    lineDiscountMinor: 0,
    discountReasonCode: null,
    discountNote: null,
    discountOverride: null,
    ...overrides,
  }
}

function cart(overrides: Partial<HoldableCart> = {}): HoldableCart {
  const lines = overrides.lines ?? [line()]
  const saleDiscount = overrides.saleDiscount ?? null
  return {
    lines,
    saleDiscount,
    loyaltyRedeemPoints: overrides.loyaltyRedeemPoints ?? 0,
    customer: overrides.customer ?? null,
    totals: computeCartTotals(
      {
        saleId: 'draft-1',
        shiftId: 'shift-now',
        lines,
        saleDiscount,
        loyaltyRedeemPoints: overrides.loyaltyRedeemPoints ?? 0,
        customer: overrides.customer ?? null,
        creditOverride: null,
        updatedAt: NOW.toISOString(),
      },
      PRICING,
    ),
    shiftId: overrides.shiftId ?? 'shift-now',
  }
}

function startCashier(): void {
  startStaffSession(BINDING)
}

afterEach(() => {
  endStaffSession()
})

describe('hold helpers', () => {
  it('labels an auto-held basket with the next free number', () => {
    expect(nextCartLabel([])).toBe('Cart #1')
    expect(nextCartLabel(['Ama', 'Cart #1', 'Cart #3'])).toBe('Cart #2')
  })

  it('takes two initials from the name and falls back to the staff id', () => {
    expect(staffInitials('Ama Mensah', 'GA-0003')).toBe('AM')
    expect(staffInitials(null, 'GA-0003')).toBe('03')
  })
})

describe('holdCart', () => {
  it('refuses an empty cart', async () => {
    startCashier()
    const { db, written } = fakeDb()

    await expect(holdCart(db, { label: 'Empty', cart: cart({ lines: [] }) })).rejects.toMatchObject(
      {
        code: 'EMPTY_CART',
      },
    )
    expect(written).toHaveLength(0)
  })

  it('refuses a blank label', async () => {
    startCashier()
    const { db } = fakeDb()

    await expect(holdCart(db, { label: '   ', cart: cart() })).rejects.toBeInstanceOf(HoldError)
  })

  it('refuses the eleventh hold', async () => {
    startCashier()
    const holds = Array.from({ length: 10 }, (_, index) => holdRow(`h-${index}`, `Cart ${index}`))
    const { db, written } = fakeDb({ state: { holds } })

    await expect(holdCart(db, { label: 'Eleven', cart: cart() })).rejects.toMatchObject({
      code: 'HOLD_LIMIT',
    })
    expect(written).toHaveLength(0)
  })

  it('writes the priced basket, its lines and who parked it', async () => {
    startCashier()
    const { db, state } = fakeDb()

    const result = await holdCart(db, { label: ' Ama’s pads ', cart: cart(), now: NOW })

    expect(result.label).toBe('Ama’s pads')
    expect(await countHeldCarts(db)).toBe(1)
    const stored = state.holds[0]
    expect(stored).toMatchObject({
      id: result.holdId,
      label: 'Ama’s pads',
      held_by_user_id: BINDING.userId,
      held_by_staff_id: BINDING.staffId,
      shift_id: 'shift-now',
      total_minor: 12_000,
      item_count: 1,
    })
    expect(state.lines[0]).toMatchObject({ hold_id: result.holdId, product_id: 'p-pad' })
  })

  it('lists holds oldest first with initials and totals', async () => {
    startCashier()
    const { db } = fakeDb({
      state: {
        holds: [
          holdRow('h-late', 'Second', { held_at: '2026-10-27T09:30:00.000Z' }),
          holdRow('h-early', 'First', { held_at: '2026-10-27T09:00:00.000Z' }),
        ],
      },
    })

    const summary = await listHeldCarts(db)

    expect(summary.map((hold) => hold.label)).toEqual(['First', 'Second'])
    expect(summary[0]).toMatchObject({
      heldByInitials: 'AM',
      itemCount: 1,
      totalMinor: 12_000,
    })
  })
})

describe('recallHeldCart', () => {
  function stateWithCatalogue(catalogue: typeof CATALOGUE): Partial<FakeState> {
    return { holds: [holdRow('hold-1', 'Ama’s pads')], lines: [holdLineRow('hold-1')], catalogue }
  }

  it('re-prices, writes the draft and deletes the hold in one transaction', async () => {
    startCashier()
    const { db, state, written } = fakeDb({ state: stateWithCatalogue(CATALOGUE) })

    const result = await recallHeldCart(db, 'hold-1', { shiftId: 'shift-now', now: NOW })

    expect(result.cart.lines).toHaveLength(1)
    expect(result.cart.lines[0]?.unitPriceMinor).toBe(12_000)
    expect(result.requiresAcknowledgement).toBe(false)
    expect(result.blockingProductIds).toEqual([])
    expect(state.holds).toHaveLength(0)

    const sql = written.map((write) => write.sql)
    const draftIndex = sql.findIndex((statement) => statement.includes('INTO cart_draft\n'))
    const deleteIndex = sql.findIndex((statement) =>
      statement.includes('DELETE FROM held_cart WHERE id'),
    )
    expect(draftIndex).toBeGreaterThan(-1)
    expect(deleteIndex).toBeGreaterThan(draftIndex)

    // The transaction is the boundary: a reload finds nothing to serve twice.
    await expect(recallHeldCart(db, 'hold-1', { shiftId: 'shift-now' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  it('reports a price that rose and demands an acknowledgement', async () => {
    startCashier()
    const { db } = fakeDb({
      state: stateWithCatalogue([
        { ...(CATALOGUE[0] as (typeof CATALOGUE)[number]), unit_price_minor: 13_200 },
      ]),
    })

    const result = await recallHeldCart(db, 'hold-1', { shiftId: 'shift-now' })

    expect(result.differences).toEqual([
      {
        productId: 'p-pad',
        name: 'Brake pad set',
        kind: 'PRICE',
        fromMinor: 12_000,
        toMinor: 13_200,
      },
    ])
    expect(result.requiresAcknowledgement).toBe(true)
    expect(result.cart.lines[0]?.unitPriceMinor).toBe(13_200)
  })

  it('blocks a cart whose product was deleted', async () => {
    startCashier()
    const { db } = fakeDb({ state: stateWithCatalogue([]) })

    const result = await recallHeldCart(db, 'hold-1', { shiftId: 'shift-now' })

    expect(result.differences[0]).toMatchObject({ kind: 'GONE', productId: 'p-pad' })
    expect(result.blockingProductIds).toEqual(['p-pad'])
    expect(result.requiresAcknowledgement).toBe(true)
    // The line is kept at its held price so the cashier can see what it was.
    expect(result.cart.lines[0]?.unitPriceMinor).toBe(12_000)
  })

  it('blocks a cart whose product was archived and keeps the tax reclassification visible', async () => {
    startCashier()
    const { db } = fakeDb({
      state: stateWithCatalogue([
        {
          ...(CATALOGUE[0] as (typeof CATALOGUE)[number]),
          is_active: 0,
          tax_category: 'ZERO_RATED',
        },
      ]),
    })

    const result = await recallHeldCart(db, 'hold-1', { shiftId: 'shift-now' })

    expect(result.blockingProductIds).toEqual(['p-pad'])
    expect(result.differences.map((difference) => difference.kind)).toEqual(['TAX', 'ARCHIVED'])
  })

  it('shrinks a redemption the account can no longer cover, and says so', async () => {
    startCashier()
    const { db } = fakeDb({
      state: {
        holds: [
          holdRow('hold-1', 'Ama’s pads', {
            customer_id: 'customer-1',
            customer_name: 'Ama Mensah',
            loyalty_redeem_points: 1_200,
          }),
        ],
        lines: [holdLineRow('hold-1')],
        catalogue: [{ ...(CATALOGUE[0] as (typeof CATALOGUE)[number]), unit_price_minor: 20_000 }],
        loyalty: { 'customer-1': 800 },
      },
    })

    const result = await recallHeldCart(db, 'hold-1', { shiftId: 'shift-now' })

    expect(result.loyalty.points).toBe(800)
    expect(result.loyalty.notice).toContain('1200 points → 800')
    expect(result.cart.loyaltyRedeemPoints).toBe(800)
    expect(result.cart.customer?.customerId).toBe('customer-1')
  })

  it('parks the active basket under Cart #N before recalling', async () => {
    startCashier()
    const { db, state } = fakeDb({
      state: {
        ...stateWithCatalogue(CATALOGUE),
        holds: [holdRow('hold-1', 'Ama’s pads'), holdRow('hold-2', 'Cart #1')],
        lines: [holdLineRow('hold-1'), holdLineRow('hold-2')],
      },
    })

    const result = await recallHeldCart(db, 'hold-1', {
      shiftId: 'shift-now',
      activeCart: cart({ lines: [line({ id: 'line-2', productId: 'p-oil' })] }),
      now: NOW,
    })

    expect(result.autoHeld?.label).toBe('Cart #2')
    expect(state.holds.some((hold) => hold.label === 'Cart #2')).toBe(true)
    // The recalled hold is gone; the auto-held one remains.
    expect(state.holds.some((hold) => hold.id === 'hold-1')).toBe(false)
  })

  it('refuses to recall over an active basket when ten are already held', async () => {
    startCashier()
    const holds = Array.from({ length: 10 }, (_, index) => holdRow(`h-${index}`, `Held ${index}`))
    const { db, state } = fakeDb({ state: { holds, lines: [holdLineRow('h-0')] } })

    await expect(
      recallHeldCart(db, 'h-0', {
        shiftId: 'shift-now',
        activeCart: cart(),
      }),
    ).rejects.toMatchObject({ code: 'HOLD_LIMIT' })

    // Nothing was destroyed and nothing was written.
    expect(state.holds).toHaveLength(10)
    expect(state.lines).toHaveLength(1)
  })

  it('leaves both baskets intact when the draft cannot be written', async () => {
    startCashier()
    const { db, state, written } = fakeDb({
      state: stateWithCatalogue(CATALOGUE),
      failOn: (sql) => sql.includes('INSERT INTO cart_draft'),
    })

    await expect(recallHeldCart(db, 'hold-1', { shiftId: 'shift-now', now: NOW })).rejects.toThrow(
      'injected write failure',
    )

    expect(written).toHaveLength(0)
    expect(state.holds).toHaveLength(1)
    expect(state.lines).toHaveLength(1)
  })

  it('refuses when nobody is signed in', async () => {
    const { db } = fakeDb({ state: stateWithCatalogue(CATALOGUE) })
    await expect(recallHeldCart(db, 'hold-1', { shiftId: 'shift-now' })).rejects.toMatchObject({
      code: 'NOT_SIGNED_IN',
    })
  })
})

describe('holds and the cart draft', () => {
  it('survive a draft load for a different shift', async () => {
    startCashier()
    const { db, written } = fakeDb({ state: { holds: [holdRow('hold-1', 'Ama’s pads')] } })

    await loadCartDraft(db, 'shift-next')

    // The loader prunes the draft by shift; a hold is terminal-scoped and must
    // never appear in its statements at all (P13-D29).
    expect(written.length).toBeGreaterThan(0)
    for (const write of written) {
      expect(write.sql).not.toContain('held_cart')
    }
  })
})
