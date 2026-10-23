import { describe, expect, it } from 'vitest'
import { isTrivialPin, isValidPinShape, pinProblem } from './pin.ts'

describe('PIN policy', () => {
  it('accepts 4 to 6 digits only', () => {
    expect(isValidPinShape('2468')).toBe(true)
    expect(isValidPinShape('246813')).toBe(true)
    expect(isValidPinShape('123')).toBe(false)
    expect(isValidPinShape('1234567')).toBe(false)
    expect(isValidPinShape('12a4')).toBe(false)
    expect(isValidPinShape(' 2468')).toBe(false)
    expect(isValidPinShape('')).toBe(false)
  })

  it('rejects repeated digits and straight sequences', () => {
    expect(isTrivialPin('0000')).toBe(true)
    expect(isTrivialPin('777777')).toBe(true)
    expect(isTrivialPin('1234')).toBe(true)
    expect(isTrivialPin('987654')).toBe(true)
    expect(isTrivialPin('2468')).toBe(false)
    expect(isTrivialPin('13579'.slice(0, 5))).toBe(false)
  })

  it('reports the first problem, shape before triviality', () => {
    expect(pinProblem('2468')).toBeNull()
    expect(pinProblem('123')).toBe('SHAPE')
    expect(pinProblem('2222')).toBe('TRIVIAL')
  })
})
