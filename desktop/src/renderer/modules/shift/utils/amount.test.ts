import { describe, expect, it } from 'vitest'
import { amountProblem } from './amount'

/**
 * Inline amount validation (Plan 08 Task 3).
 *
 * The distinction that matters: an *incomplete* amount is silent, a *wrong* one is explained.
 * Getting that backwards either flashes an error between keystrokes or leaves a dead button.
 */
describe('amountProblem', () => {
  it('says nothing about an empty field, because nothing has been typed yet', () => {
    expect(amountProblem('')).toBeNull()
    expect(amountProblem('   ')).toBeNull()
  })

  it('says nothing about a trailing decimal point, which is a half-typed amount', () => {
    expect(amountProblem('200.')).toBeNull()
  })

  it('accepts the shapes a cashier actually types', () => {
    expect(amountProblem('200')).toBeNull()
    expect(amountProblem('12.5')).toBeNull()
    expect(amountProblem('12.50')).toBeNull()
    expect(amountProblem('1,234.05')).toBeNull()
    expect(amountProblem('0')).toBeNull()
  })

  it('explains a value that is not a number', () => {
    expect(amountProblem('abc')).toBe('Enter an amount like 200.00')
    expect(amountProblem('12.505')).toBe('Enter an amount like 200.00')
    expect(amountProblem('-5')).toBe('Enter an amount like 200.00')
    expect(amountProblem('200..5')).toBe('Enter an amount like 200.00')
  })

  it('enforces a minimum when one is given', () => {
    expect(amountProblem('0', 1)).toContain('at least')
    expect(amountProblem('0.01', 1)).toBeNull()
  })
})
