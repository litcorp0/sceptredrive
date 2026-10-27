import { describe, expect, it } from 'vitest'
import {
  type CatalogueSnapshotLine,
  HOLD_LABEL_MAX,
  type HoldLine,
  holdLabelProblem,
  MAX_HELD_CARTS,
  repriceHeldCart,
} from './hold.ts'
import { priceCart } from './pos.ts'

function holdLine(overrides: Partial<HoldLine> = {}): HoldLine {
  return {
    productId: 'p1',
    sku: 'GIK-00001',
    name: 'Brake pad',
    quantity: 1,
    unitPriceMinor: 10_000,
    taxCategory: 'STANDARD',
    lineDiscountMinor: 0,
    lineDiscountReason: null,
    lineDiscountNote: null,
    ...overrides,
  }
}

function catalogueLine(overrides: Partial<CatalogueSnapshotLine> = {}): CatalogueSnapshotLine {
  return {
    productId: 'p1',
    name: 'Brake pad',
    sku: 'GIK-00001',
    unitPriceMinor: 10_000,
    taxCategory: 'STANDARD',
    isActive: true,
    ...overrides,
  }
}

describe('hold limits', () => {
  it('caps a terminal at ten held carts and a label at sixty characters', () => {
    expect(MAX_HELD_CARTS).toBe(10)
    expect(HOLD_LABEL_MAX).toBe(60)
  })
})

describe('holdLabelProblem', () => {
  it('refuses an empty or blank label', () => {
    expect(holdLabelProblem('', 0)).toBe('Give the cart a name so you can find it')
    expect(holdLabelProblem('   ', 0)).toBe('Give the cart a name so you can find it')
  })

  it('accepts a label at the length cap and refuses one over it', () => {
    expect(holdLabelProblem('a'.repeat(HOLD_LABEL_MAX), 0)).toBeNull()
    expect(holdLabelProblem('a'.repeat(HOLD_LABEL_MAX + 1), 0)).toBe(
      'Keep the name to 60 characters or fewer',
    )
  })

  it('measures the trimmed label, not the whitespace around it', () => {
    expect(holdLabelProblem(`  ${'a'.repeat(HOLD_LABEL_MAX)}  `, 0)).toBeNull()
  })

  it('refuses a new hold at ten and accepts one at nine', () => {
    expect(holdLabelProblem('Counter', MAX_HELD_CARTS - 1)).toBeNull()
    expect(holdLabelProblem('Counter', MAX_HELD_CARTS)).toBe(
      'Ten carts are already held on this till. Use one or void one.',
    )
    expect(holdLabelProblem('Counter', MAX_HELD_CARTS + 1)).toBe(
      'Ten carts are already held on this till. Use one or void one.',
    )
  })
})

describe('repriceHeldCart', () => {
  it('re-prices to today, flags archive and deletion, and clamps a discount', () => {
    const result = repriceHeldCart({
      lines: [
        holdLine({ productId: 'p1', quantity: 2, unitPriceMinor: 10_000 }),
        holdLine({
          productId: 'p2',
          sku: 'GIK-00002',
          name: 'Oil filter old',
          unitPriceMinor: 5_000,
        }),
        holdLine({ productId: 'p3', sku: 'GIK-00003', name: 'Wiper blade', unitPriceMinor: 3_000 }),
        holdLine({
          productId: 'p4',
          sku: 'GIK-00004',
          name: 'Washer fluid',
          unitPriceMinor: 1_000,
          lineDiscountMinor: 5_000,
          lineDiscountReason: 'Manager goodwill',
        }),
      ],
      catalogue: [
        catalogueLine({ productId: 'p1', name: 'Brake pad', unitPriceMinor: 20_000 }),
        catalogueLine({
          productId: 'p2',
          name: 'Oil filter HD',
          unitPriceMinor: 8_000,
          isActive: false,
        }),
        catalogueLine({ productId: 'p4', name: 'Washer fluid', unitPriceMinor: 1_000 }),
      ],
      loyaltyPointsRequested: 250,
      pricing: { taxMode: 'INCLUSIVE' },
    })

    expect(result.differences).toEqual([
      {
        productId: 'p1',
        name: 'Brake pad',
        kind: 'PRICE',
        fromMinor: 10_000,
        toMinor: 20_000,
      },
      {
        productId: 'p2',
        name: 'Oil filter HD',
        kind: 'ARCHIVED',
        fromMinor: 5_000,
        toMinor: 8_000,
      },
      {
        productId: 'p3',
        name: 'Wiper blade',
        kind: 'GONE',
        fromMinor: 3_000,
        toMinor: 3_000,
      },
    ])
    expect(result.requiresAcknowledgement).toBe(true)
    expect(result.loyaltyPointsRequested).toBe(250)

    expect(result.lines).toHaveLength(4)
    const [first, second, third, fourth] = result.lines
    if (!first || !second || !third || !fourth) throw new Error('expected four repriced lines')

    expect(first).toMatchObject({
      productId: 'p1',
      name: 'Brake pad',
      quantity: 2,
      unitPriceMinor: 20_000,
      lineDiscountMinor: 0,
    })
    expect(second).toMatchObject({
      productId: 'p2',
      name: 'Oil filter HD',
      unitPriceMinor: 8_000,
    })
    // The deleted product keeps its old price so the cashier can see what it was.
    expect(third).toMatchObject({
      productId: 'p3',
      name: 'Wiper blade',
      unitPriceMinor: 3_000,
      taxCategory: 'STANDARD',
    })
    expect(fourth).toMatchObject({
      productId: 'p4',
      unitPriceMinor: 1_000,
      lineDiscountMinor: 1_000,
      lineDiscountReason: 'Manager goodwill',
    })
  })

  it('clamps a line discount before pricing, because priceCart rejects an over-discount', () => {
    const stale = holdLine({ unitPriceMinor: 1_000, lineDiscountMinor: 5_000 })

    expect(() =>
      priceCart(
        [
          {
            productId: stale.productId,
            name: stale.name,
            sku: stale.sku,
            quantity: stale.quantity,
            unitPriceMinor: stale.unitPriceMinor,
            lineDiscountMinor: stale.lineDiscountMinor,
            taxCategory: stale.taxCategory,
          },
        ],
        { taxMode: 'INCLUSIVE' },
      ),
    ).toThrow(RangeError)

    const result = repriceHeldCart({
      lines: [stale],
      catalogue: [catalogueLine({ unitPriceMinor: 1_000 })],
      loyaltyPointsRequested: 0,
      pricing: { taxMode: 'INCLUSIVE' },
    })

    const line = result.lines[0]
    if (!line) throw new Error('expected one repriced line')
    expect(line.lineDiscountMinor).toBe(line.unitPriceMinor * line.quantity)
  })

  it('reports no difference when the catalogue has not moved', () => {
    const result = repriceHeldCart({
      lines: [holdLine({ lineDiscountMinor: 500, lineDiscountReason: 'Promo' })],
      catalogue: [catalogueLine()],
      loyaltyPointsRequested: 150,
      pricing: { taxMode: 'INCLUSIVE' },
    })

    expect(result.differences).toEqual([])
    expect(result.requiresAcknowledgement).toBe(false)
    expect(result.loyaltyPointsRequested).toBe(150)

    const line = result.lines[0]
    if (!line) throw new Error('expected one repriced line')
    expect(line.lineDiscountMinor).toBe(500)
    expect(line.lineDiscountReason).toBe('Promo')
  })

  it('treats an archived product as a difference even when its price is unchanged', () => {
    const result = repriceHeldCart({
      lines: [holdLine()],
      catalogue: [catalogueLine({ isActive: false })],
      loyaltyPointsRequested: 0,
      pricing: { taxMode: 'INCLUSIVE' },
    })

    expect(result.differences).toEqual([
      {
        productId: 'p1',
        name: 'Brake pad',
        kind: 'ARCHIVED',
        fromMinor: 10_000,
        toMinor: 10_000,
      },
    ])
    expect(result.requiresAcknowledgement).toBe(true)
  })

  it('reports a tax-category change as a difference even when the price is unchanged', () => {
    const result = repriceHeldCart({
      lines: [holdLine({ taxCategory: 'STANDARD' })],
      catalogue: [catalogueLine({ taxCategory: 'ZERO_RATED' })],
      loyaltyPointsRequested: 0,
      pricing: { taxMode: 'EXCLUSIVE' },
    })

    // 100.00 exclusive: STANDARD totals 120.00, ZERO_RATED totals 100.00.
    expect(result.differences).toEqual([
      {
        productId: 'p1',
        name: 'Brake pad',
        kind: 'TAX',
        fromMinor: 12_000,
        toMinor: 10_000,
      },
    ])
    expect(result.requiresAcknowledgement).toBe(true)

    const line = result.lines[0]
    if (!line) throw new Error('expected one repriced line')
    expect(line.taxCategory).toBe('ZERO_RATED')
  })

  it('reports tax before price when a line moves both', () => {
    const result = repriceHeldCart({
      lines: [holdLine({ unitPriceMinor: 10_000, taxCategory: 'STANDARD' })],
      catalogue: [catalogueLine({ unitPriceMinor: 15_000, taxCategory: 'ZERO_RATED' })],
      loyaltyPointsRequested: 0,
      pricing: { taxMode: 'EXCLUSIVE' },
    })

    expect(result.differences.map((difference) => difference.kind)).toEqual(['TAX', 'PRICE'])
    expect(result.differences).toEqual([
      {
        productId: 'p1',
        name: 'Brake pad',
        kind: 'TAX',
        fromMinor: 12_000,
        toMinor: 15_000,
      },
      {
        productId: 'p1',
        name: 'Brake pad',
        kind: 'PRICE',
        fromMinor: 10_000,
        toMinor: 15_000,
      },
    ])
    expect(result.requiresAcknowledgement).toBe(true)
  })

  it('keeps every line when the catalogue is empty instead of throwing', () => {
    const result = repriceHeldCart({
      lines: [
        holdLine({ productId: 'p1', name: 'Brake pad', unitPriceMinor: 10_000 }),
        holdLine({ productId: 'p2', sku: 'GIK-00002', name: 'Oil filter', unitPriceMinor: 5_000 }),
      ],
      catalogue: [],
      loyaltyPointsRequested: 0,
      pricing: { taxMode: 'INCLUSIVE' },
    })

    expect(result.lines).toHaveLength(2)
    expect(result.differences).toEqual([
      {
        productId: 'p1',
        name: 'Brake pad',
        kind: 'GONE',
        fromMinor: 10_000,
        toMinor: 10_000,
      },
      {
        productId: 'p2',
        name: 'Oil filter',
        kind: 'GONE',
        fromMinor: 5_000,
        toMinor: 5_000,
      },
    ])
    expect(result.requiresAcknowledgement).toBe(true)
  })
})
