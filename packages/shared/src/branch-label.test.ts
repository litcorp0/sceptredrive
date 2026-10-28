import { describe, expect, it } from 'vitest'
import { formatBranchLabel } from './branch-label.ts'

describe('formatBranchLabel', () => {
  it('puts the name first and the code in brackets', () => {
    expect(formatBranchLabel({ name: 'Accra Spintex', code: 'ACC-SPX' })).toBe(
      'Accra Spintex (ACC-SPX)',
    )
  })

  it('falls back to whichever part exists', () => {
    expect(formatBranchLabel({ name: 'Accra Spintex', code: '' })).toBe('Accra Spintex')
    expect(formatBranchLabel({ name: '', code: 'ACC-SPX' })).toBe('ACC-SPX')
    expect(formatBranchLabel(null)).toBe('—')
  })

  it('trims stray whitespace', () => {
    expect(formatBranchLabel({ name: ' Tema ', code: ' TM-MAN ' })).toBe('Tema (TM-MAN)')
  })
})
