import { describe, expect, it } from 'vitest'
import { allocateProportionally, type CartLineInput, priceCart } from './pos.ts'
import { taxBreakdown } from './tax.ts'

function line(overrides: Partial<CartLineInput> = {}): CartLineInput {
  return {
    productId: 'p1',
    name: 'Brake pad',
    sku: 'SDP-00001',
    quantity: 1,
    unitPriceMinor: 10000,
    taxCategory: 'STANDARD',
    ...overrides,
  }
}

describe('allocateProportionally', () => {
  it('splits an amount exactly using largest remainder', () => {
    expect(allocateProportionally(100, [1, 1, 1])).toEqual([34, 33, 33])
    expect(allocateProportionally(5, [1, 1])).toEqual([3, 2])
    expect(allocateProportionally(7, [3, 3, 1])).toEqual([3, 3, 1])
  })

  it('handles zero amounts and zero weights', () => {
    expect(allocateProportionally(0, [5, 0, 2])).toEqual([0, 0, 0])
    expect(allocateProportionally(0, [])).toEqual([])
    expect(allocateProportionally(10, [0, 0, 1])).toEqual([0, 0, 10])
  })

  it('distributes an amount larger than the weights', () => {
    expect(allocateProportionally(10, [1, 1])).toEqual([5, 5])
  })

  it('rejects invalid input', () => {
    expect(() => allocateProportionally(1, [0, 0])).toThrow(RangeError)
    expect(() => allocateProportionally(-1, [1])).toThrow(TypeError)
    expect(() => allocateProportionally(1, [-1])).toThrow(TypeError)
    expect(() => allocateProportionally(1.5, [1])).toThrow(TypeError)
  })
})

describe('priceCart', () => {
  /**
   * A business that is not VAT-registered charges nothing: no VAT, no NHIL, no
   * GETFund, whatever the product says. The line is stored as `EXEMPT`, because
   * that is what the supply was.
   */
  it('charges no levy at all when the business is not VAT-registered', () => {
    const cart = priceCart([line({ quantity: 3, unitPriceMinor: 55_000 })], {
      taxMode: 'INCLUSIVE',
      vatRegistered: false,
    })

    const priced = cart.lines[0]
    if (!priced) throw new Error('expected one priced line')
    expect(priced.taxCategory).toBe('EXEMPT')
    expect(priced.vatMinor).toBe(0)
    expect(priced.nhilMinor).toBe(0)
    expect(priced.getfundMinor).toBe(0)
    expect(priced.taxTotalMinor).toBe(0)
    expect(priced.totalMinor).toBe(165_000)
    expect(priced.baseMinor).toBe(165_000)
    expect(cart.taxTotalMinor).toBe(0)
    expect(cart.totalMinor).toBe(165_000)
  })

  it('keeps the catalogue category when the flag is omitted, so tax cannot vanish by accident', () => {
    const cart = priceCart([line()], { taxMode: 'INCLUSIVE' })
    expect(cart.lines[0]?.taxCategory).toBe('STANDARD')
    expect(cart.taxTotalMinor).toBeGreaterThan(0)
  })

  it('prices a tax-inclusive standard line', () => {
    const cart = priceCart([line()], { taxMode: 'INCLUSIVE' })
    const expected = taxBreakdown(10000, 'STANDARD', 'INCLUSIVE')

    expect(cart.lines).toHaveLength(1)
    const priced = cart.lines[0]
    if (!priced) throw new Error('expected one priced line')
    expect(priced).toMatchObject(expected)
    expect(cart.totalMinor).toBe(expected.totalMinor)
    expect(cart.taxableMinor).toBe(expected.baseMinor + expected.taxTotalMinor)
    expect(priced.baseMinor + priced.vatMinor + priced.nhilMinor + priced.getfundMinor).toBe(
      priced.totalMinor,
    )
  })

  it('prices a tax-exclusive standard line', () => {
    const cart = priceCart([line()], { taxMode: 'EXCLUSIVE' })
    const expected = taxBreakdown(10000, 'STANDARD', 'EXCLUSIVE')

    expect(cart.totalMinor).toBe(expected.totalMinor)
    expect(cart.totalMinor).toBe(12000)
    expect(cart.baseMinor).toBe(10000)
    expect(cart.taxTotalMinor).toBe(2000)
  })

  it('handles zero-rated and exempt lines without tax', () => {
    const cart = priceCart(
      [
        line({ productId: 'p1', taxCategory: 'ZERO_RATED' }),
        line({ productId: 'p2', taxCategory: 'EXEMPT', unitPriceMinor: 5000 }),
      ],
      { taxMode: 'INCLUSIVE' },
    )

    expect(cart.taxTotalMinor).toBe(0)
    expect(cart.totalMinor).toBe(15000)
    expect(cart.taxableMinor).toBe(15000)
  })

  it('applies line discounts before tax', () => {
    const cart = priceCart([line({ lineDiscountMinor: 2000 })], { taxMode: 'INCLUSIVE' })
    const expected = taxBreakdown(8000, 'STANDARD', 'INCLUSIVE')

    expect(cart.lineDiscountMinor).toBe(2000)
    expect(cart.netMinor).toBe(8000)
    expect(cart.totalMinor).toBe(expected.totalMinor)
  })

  it('allocates a sale discount pro-rata and keeps the total exact', () => {
    const cart = priceCart(
      [
        line({ productId: 'p1', unitPriceMinor: 10000 }),
        line({ productId: 'p2', unitPriceMinor: 10000 }),
        line({ productId: 'p3', unitPriceMinor: 10000 }),
      ],
      { taxMode: 'INCLUSIVE', saleDiscountMinor: 1 },
    )

    expect(cart.saleDiscountMinor).toBe(1)
    expect(cart.lines.map((priced) => priced.saleDiscountMinor)).toEqual([1, 0, 0])
    expect(cart.lines.reduce((total, priced) => total + priced.totalMinor, 0)).toBe(cart.totalMinor)
  })

  it('clamps sale and loyalty discounts to what the cart can absorb', () => {
    const cart = priceCart([line()], {
      taxMode: 'INCLUSIVE',
      saleDiscountMinor: 50000,
      loyaltyDiscountMinor: 50000,
    })

    expect(cart.saleDiscountMinor).toBe(10000)
    expect(cart.loyaltyDiscountMinor).toBe(0)
    expect(cart.totalMinor).toBe(0)
  })

  it('supports a fully discounted or fully redeemed cart', () => {
    const discounted = priceCart([line({ lineDiscountMinor: 10000 })], {
      taxMode: 'INCLUSIVE',
    })
    expect(discounted.totalMinor).toBe(0)

    const redeemed = priceCart([line()], {
      taxMode: 'INCLUSIVE',
      loyaltyDiscountMinor: 10000,
    })
    expect(redeemed.totalMinor).toBe(0)
    expect(redeemed.loyaltyDiscountMinor).toBe(10000)
    expect(redeemed.taxableMinor).toBe(0)
  })

  it('rejects invalid line data', () => {
    expect(() => priceCart([line({ quantity: 0 })], { taxMode: 'INCLUSIVE' })).toThrow(TypeError)
    expect(() => priceCart([line({ unitPriceMinor: -1 })], { taxMode: 'INCLUSIVE' })).toThrow(
      TypeError,
    )
    expect(() => priceCart([line({ lineDiscountMinor: 10001 })], { taxMode: 'INCLUSIVE' })).toThrow(
      RangeError,
    )
    expect(() =>
      priceCart([line({ taxCategory: 'UNKNOWN' as never })], { taxMode: 'INCLUSIVE' }),
    ).toThrow(TypeError)
  })

  it('keeps every cart invariant across many generated carts', () => {
    let seed = 987654321
    const next = (max: number): number => {
      seed = (seed * 1664525 + 1013904223) % 4294967296
      return seed % max
    }
    const categories = ['STANDARD', 'ZERO_RATED', 'EXEMPT'] as const
    const modes = ['INCLUSIVE', 'EXCLUSIVE'] as const

    for (let run = 0; run < 250; run += 1) {
      const count = 1 + next(5)
      const lines: CartLineInput[] = []
      for (let index = 0; index < count; index += 1) {
        const unitPriceMinor = next(50000)
        lines.push(
          line({
            productId: `p${index}`,
            quantity: 1 + next(6),
            unitPriceMinor,
            taxCategory: categories[next(categories.length)] ?? 'STANDARD',
            lineDiscountMinor: next(Math.min(unitPriceMinor, 2000) + 1),
          }),
        )
      }

      const mode = modes[next(modes.length)] ?? 'INCLUSIVE'
      const cart = priceCart(lines, {
        taxMode: mode,
        saleDiscountMinor: next(1500),
        loyaltyDiscountMinor: next(1500),
      })

      expect(cart.subtotalMinor).toBe(
        cart.lines.reduce((total, priced) => total + priced.grossMinor, 0),
      )
      expect(cart.saleDiscountMinor).toBe(
        cart.lines.reduce((total, priced) => total + priced.saleDiscountMinor, 0),
      )
      expect(cart.loyaltyDiscountMinor).toBe(
        cart.lines.reduce((total, priced) => total + priced.loyaltyDiscountMinor, 0),
      )
      expect(cart.totalMinor).toBe(
        cart.lines.reduce((total, priced) => total + priced.totalMinor, 0),
      )
      expect(cart.totalMinor).toBe(cart.baseMinor + cart.taxTotalMinor)

      for (const priced of cart.lines) {
        expect(priced.totalMinor).toBe(priced.baseMinor + priced.taxTotalMinor)
        expect(priced.taxTotalMinor).toBe(priced.vatMinor + priced.nhilMinor + priced.getfundMinor)
        expect(priced.taxableMinor).toBe(
          priced.grossMinor -
            priced.lineDiscountMinor -
            priced.saleDiscountMinor -
            priced.loyaltyDiscountMinor,
        )
        expect(priced.taxableMinor).toBeGreaterThanOrEqual(0)
      }
    }
  })
})
