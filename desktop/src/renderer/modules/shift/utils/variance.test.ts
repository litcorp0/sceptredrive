import { describe, expect, it } from 'vitest'
import { formatGhs } from '@/lib/format'
import { varianceWords } from './variance'

/**
 * The variance sentence (Plan 08 Task 3).
 *
 * GHS 12.00 over and GHS 12.00 short must read differently without colour. The currency
 * prefix is `formatGhs`'s business (the ICU symbol differs between builds, which is why
 * `format.test.ts` asserts `toContain`), so these cases assert the words and the sign
 * handling rather than a hard-coded prefix.
 */
describe('varianceWords', () => {
  it('says Over for cash in the drawer beyond the expected figure', () => {
    expect(varianceWords(1_200)).toBe(`Over ${formatGhs(1_200)}`)
    expect(varianceWords(1_200)).toContain('12.00')
  })

  it('says Short in positive money for cash missing from the drawer', () => {
    expect(varianceWords(-400)).toBe(`Short ${formatGhs(400)}`)
    // The minus is arithmetic, not typography: the sentence carries the direction.
    expect(varianceWords(-400)).not.toContain('-')
  })

  it('says Exact when the drawer matches', () => {
    expect(varianceWords(0)).toBe('Exact')
  })

  it('works in pesewas, not cedis', () => {
    expect(varianceWords(1)).toContain('0.01')
    expect(varianceWords(-1)).toBe(`Short ${formatGhs(1)}`)
  })
})
