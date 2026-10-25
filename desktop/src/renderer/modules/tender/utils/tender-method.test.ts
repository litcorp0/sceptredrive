import { describe, expect, it } from 'vitest'
import { nextTenderMethod } from './tender-method'

/**
 * The guard behind the tender screen's payment-method pair.
 *
 * Radix `ToggleGroup type="single"` reports `''` when the pressed item is pressed
 * again (its documented "ensuring there is always a value" caveat). Clearing the
 * method would leave the screen with no tender, so the choice must survive it.
 */
describe('nextTenderMethod', () => {
  it('accepts the two methods the till understands', () => {
    expect(nextTenderMethod('CASH', 'CREDIT')).toBe('CASH')
    expect(nextTenderMethod('CREDIT', 'CASH')).toBe('CREDIT')
  })

  it('keeps the current method when the pressed item is pressed again', () => {
    expect(nextTenderMethod('', 'CASH')).toBe('CASH')
    expect(nextTenderMethod('', 'CREDIT')).toBe('CREDIT')
  })

  it('keeps the current method for a value that is not a tender method', () => {
    expect(nextTenderMethod('ELECTRONIC', 'CASH')).toBe('CASH')
    expect(nextTenderMethod('cash', 'CREDIT')).toBe('CREDIT')
  })
})
