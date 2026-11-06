import { describe, expect, it } from 'vitest'
import { buildAvailability, buildCarried } from './availability'

/**
 * One availability number for the catalogue badge and the cart's `+` (P20-D9).
 *
 * The terminal's own unacked sales count against stock: a unit sold but not yet
 * uploaded is still gone from the shelf, and ignoring it lets a cashier resell it.
 */
describe('buildAvailability', () => {
  it('adds this terminal’s unacked deltas to the synced on-hand', () => {
    const available = buildAvailability(
      [
        { product_id: 'a', quantity_on_hand: 11 },
        { product_id: 'b', quantity_on_hand: 4 },
      ],
      [{ product_id: 'a', quantity_delta: -2 }],
    )

    expect(available.get('a')).toBe(9)
    // No delta row: the synced figure stands.
    expect(available.get('b')).toBe(4)
  })

  it('leaves a deltas-only product absent rather than inventing a level', () => {
    const available = buildAvailability([], [{ product_id: 'a', quantity_delta: -2 }])
    expect(available.has('a')).toBe(false)
  })

  it('keeps an oversold level negative, so the control stays closed', () => {
    const available = buildAvailability(
      [{ product_id: 'a', quantity_on_hand: 1 }],
      [{ product_id: 'a', quantity_delta: -3 }],
    )
    expect(available.get('a')).toBe(-2)
  })
})

describe('buildCarried', () => {
  it('treats a stock level as "this branch carries it", even at zero', () => {
    const carried = buildCarried([
      { product_id: 'a', quantity_on_hand: 11 },
      { product_id: 'b', quantity_on_hand: 0 },
    ])

    expect(carried.has('a')).toBe(true)
    // Zero on hand is "out of stock", not "never stocked here".
    expect(carried.has('b')).toBe(true)
    // No row at all is the branch never carrying it.
    expect(carried.has('c')).toBe(false)
  })
})
