import { describe, expect, it } from 'vitest'
import { appendPesewaDigit, removePesewaDigit } from './pesewa'

/**
 * The tender keypad's digit model (Plan 09 found the number row could not reach it).
 *
 * Digits are pesewas: 5, 0, 0 is GH₵5.00. These cases pin the two behaviours a cashier relies
 * on — typing after a clear does not produce `0500`, and Backspace removes one digit rather
 * than dividing by ten (the same thing only for round numbers).
 */
describe('appendPesewaDigit', () => {
  it('builds pesewas one digit at a time', () => {
    expect(appendPesewaDigit(0, '5')).toBe(5)
    expect(appendPesewaDigit(5, '0')).toBe(50)
    expect(appendPesewaDigit(50, '0')).toBe(500)
  })

  it('drops a leading zero instead of growing 0500', () => {
    expect(appendPesewaDigit(0, '0')).toBe(0)
    expect(appendPesewaDigit(0, '5')).toBe(5)
  })

  it('stops at nine digits', () => {
    expect(appendPesewaDigit(123_456_789, '0')).toBe(123_456_789)
  })

  it('ignores a key that is not a digit', () => {
    expect(appendPesewaDigit(500, 'x')).toBe(500)
    expect(appendPesewaDigit(500, '')).toBe(500)
  })
})

describe('removePesewaDigit', () => {
  it('removes the last digit', () => {
    expect(removePesewaDigit(500)).toBe(50)
    expect(removePesewaDigit(50)).toBe(5)
    expect(removePesewaDigit(5)).toBe(0)
  })

  it('removes one digit from a value ending in zero, not a tenth of it', () => {
    expect(removePesewaDigit(1_050)).toBe(105)
    expect(removePesewaDigit(1_055)).toBe(105)
  })

  it('is empty at zero', () => {
    expect(removePesewaDigit(0)).toBe(0)
  })
})
