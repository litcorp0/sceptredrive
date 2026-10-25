import { describe, expect, it } from 'vitest'
import { type AttentionCounts, attentionItems } from './attention'

/**
 * The needs-attention strip (Plan 04 §7).
 *
 * The point of these cases is not the wording: it is that an item only exists when there is
 * something to act on, and that every route leads to a screen that exists today. There is no
 * POS stock screen, so "out of stock" is a labelled count with no link (P10-D2).
 */

const NOTHING: AttentionCounts = {
  unprinted: 0,
  openConflicts: 0,
  highSeverityConflicts: 0,
  uploads: 0,
  outOfStock: 0,
}

describe('attentionItems', () => {
  it('is empty when nothing needs attention', () => {
    expect(attentionItems(NOTHING)).toEqual([])
  })

  it('carries the route a cashier can actually reach, and none for out of stock', () => {
    const items = attentionItems({
      unprinted: 2,
      openConflicts: 1,
      highSeverityConflicts: 0,
      uploads: 3,
      outOfStock: 4,
    })

    expect(items.map((item) => item.id)).toEqual([
      'unprinted',
      'conflicts',
      'uploads',
      'out-of-stock',
    ])
    expect(items.map((item) => item.route)).toEqual(['pos/sales', 'pos/sync', 'pos/sync', null])
  })

  it('omits every zero count individually', () => {
    const onlyStock = attentionItems({ ...NOTHING, outOfStock: 1 })
    expect(onlyStock.map((item) => item.id)).toEqual(['out-of-stock'])

    const onlyUnprinted = attentionItems({ ...NOTHING, unprinted: 1 })
    expect(onlyUnprinted.map((item) => item.id)).toEqual(['unprinted'])
  })

  it('raises conflicts to danger only when one is HIGH severity', () => {
    const plain = attentionItems({ ...NOTHING, openConflicts: 2 })
    expect(plain[0]?.tone).toBe('warn')
    expect(plain[0]?.detail).toBe('Awaiting review')

    const high = attentionItems({ ...NOTHING, openConflicts: 2, highSeverityConflicts: 1 })
    expect(high[0]?.tone).toBe('danger')
    expect(high[0]?.detail).toBe('1 high severity')
  })

  it('never returns a count that is not a safe positive integer', () => {
    const items = attentionItems({
      unprinted: 1.5,
      openConflicts: Number.NaN,
      highSeverityConflicts: -2,
      uploads: Number.POSITIVE_INFINITY,
      outOfStock: 3,
    })

    expect(items.map((item) => item.id)).toEqual(['out-of-stock'])
    expect(items.every((item) => Number.isSafeInteger(item.count))).toBe(true)
  })

  it('passes ordinary counts through unchanged', () => {
    const items = attentionItems({
      ...NOTHING,
      uploads: Number.MAX_SAFE_INTEGER,
      outOfStock: 7,
    })

    expect(items.find((item) => item.id === 'uploads')?.count).toBe(Number.MAX_SAFE_INTEGER)
    expect(items.find((item) => item.id === 'out-of-stock')?.count).toBe(7)
  })
})
