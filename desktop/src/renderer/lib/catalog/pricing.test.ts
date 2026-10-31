import { describe, expect, it } from 'vitest'
import {
  availableQuantity,
  displayPriceMinor,
  indexByProduct,
  isTaxCategory,
  outOfStockBlocked,
  stockBadge,
  toSellableProduct,
} from './pricing'
import type { CatalogProductRow } from './search'

function row(overrides: Partial<CatalogProductRow> = {}): CatalogProductRow {
  return {
    id: '11111111-1111-7111-8111-111111111111',
    sku: 'GIK-00001',
    name: 'Brake Pad Set',
    base_price_minor: 10_000,
    tax_category: 'STANDARD',
    barcode: '4006381333931',
    ...overrides,
  }
}

describe('toSellableProduct', () => {
  it('uses the base price when the branch has no override', () => {
    expect(toSellableProduct(row(), null)?.unitPriceMinor).toBe(10_000)
  })

  it('prefers the branch override', () => {
    expect(toSellableProduct(row(), 12_500)?.unitPriceMinor).toBe(12_500)
  })

  it('carries the identity fields the cart and receipt need', () => {
    const product = toSellableProduct(row(), null)
    expect(product).toEqual({
      id: row().id,
      sku: 'GIK-00001',
      name: 'Brake Pad Set',
      barcode: '4006381333931',
      unitPriceMinor: 10_000,
      taxCategory: 'STANDARD',
    })
  })

  it('refuses a row with an unknown tax category', () => {
    expect(toSellableProduct(row({ tax_category: 'LUXURY' }), null)).toBeNull()
  })

  it('refuses a negative or non-integer price', () => {
    expect(toSellableProduct(row({ base_price_minor: -1 }), null)).toBeNull()
    expect(toSellableProduct(row({ base_price_minor: 10.5 }), null)).toBeNull()
  })

  it('exposes a display price only when the row is sellable', () => {
    expect(displayPriceMinor(row(), 20_000)).toBe(20_000)
    expect(displayPriceMinor(row({ tax_category: 'LUXURY' }), null)).toBeNull()
  })
})

describe('isTaxCategory', () => {
  it('accepts the three Ghana categories and nothing else', () => {
    expect(isTaxCategory('STANDARD')).toBe(true)
    expect(isTaxCategory('ZERO_RATED')).toBe(true)
    expect(isTaxCategory('EXEMPT')).toBe(true)
    expect(isTaxCategory('standard')).toBe(false)
    expect(isTaxCategory(null)).toBe(false)
  })
})

describe('stock', () => {
  it('adds pending local deltas to synced stock', () => {
    expect(availableQuantity(10, -3)).toBe(7)
    expect(availableQuantity(0, 0)).toBe(0)
    expect(availableQuantity(Number.NaN, 2)).toBe(2)
  })

  it('uses the branch threshold for "low", not a hard-coded five', () => {
    expect(stockBadge(3, 2)).toEqual({ label: '3 in stock', tone: 'ok' })
    expect(stockBadge(2, 2)).toEqual({ label: '2 left', tone: 'low' })
    expect(stockBadge(9, 10)).toEqual({ label: '9 left', tone: 'low' })
  })

  it('decides when an out-of-stock add needs authorisation', () => {
    // Pre-18 behaviour: badge only.
    expect(outOfStockBlocked('ALLOW', 0)).toBe(false)
    expect(outOfStockBlocked('BLOCK', 0)).toBe(true)
    // Anything on hand is addable; an oversold level is still a blocked add.
    expect(outOfStockBlocked('BLOCK', 1)).toBe(false)
    expect(outOfStockBlocked('BLOCK', -2)).toBe(true)
  })

  it('labels oversold, out, low, and healthy stock', () => {
    expect(stockBadge(-2)).toEqual({ label: '2 oversold', tone: 'oversold' })
    expect(stockBadge(0)).toEqual({ label: 'Out of stock', tone: 'out' })
    expect(stockBadge(3)).toEqual({ label: '3 left', tone: 'low' })
    expect(stockBadge(40)).toEqual({ label: '40 in stock', tone: 'ok' })
  })
})

describe('indexByProduct', () => {
  it('keeps the last row for a duplicated product id', () => {
    const index = indexByProduct([
      { product_id: 'a', quantity_on_hand: 1 },
      { product_id: 'b', quantity_on_hand: 2 },
      { product_id: 'a', quantity_on_hand: 3 },
    ])
    expect(index.get('a')?.quantity_on_hand).toBe(3)
    expect(index.get('b')?.quantity_on_hand).toBe(2)
    expect(index.get('c')).toBeUndefined()
  })
})
