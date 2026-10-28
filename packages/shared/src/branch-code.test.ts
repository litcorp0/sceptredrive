import { describe, expect, it } from 'vitest'
import { isValidBranchCode, normalizeBranchCode, suggestBranchCode } from './branch-code.ts'

describe('suggestBranchCode', () => {
  it('builds a retail code from city and area', () => {
    expect(suggestBranchCode({ city: 'Accra', area: 'Spintex', type: 'RETAIL' }).code).toBe(
      'ACC-SPX',
    )
    expect(suggestBranchCode({ city: 'Kumasi', area: 'Adum', type: 'RETAIL' }).code).toBe('KUM-ADM')
  })

  it('normalizes case, accents, and punctuation', () => {
    expect(suggestBranchCode({ city: "Côte d'Ivoire", area: 'Zone 4', type: 'RETAIL' }).code).toBe(
      'COT-ZON',
    )
  })

  it('uses a numbered retail fallback when no area is provided', () => {
    expect(suggestBranchCode({ city: 'Tamale', type: 'RETAIL' }).code).toBe('TAM-R1')
    expect(
      suggestBranchCode({
        city: 'Tamale',
        type: 'RETAIL',
        existingCodes: ['TAM-R1'],
      }),
    ).toEqual({ code: 'TAM-R2', adjusted: true })
  })

  it('falls back when the city has no usable characters', () => {
    expect(suggestBranchCode({ city: '---', type: 'RETAIL' }).code).toBe('BRN-R1')
    expect(suggestBranchCode({ city: '---', type: 'WAREHOUSE' }).code).toBe('BRN-WH1')
  })

  it('numbers warehouses per city', () => {
    expect(suggestBranchCode({ city: 'Accra', type: 'WAREHOUSE' }).code).toBe('ACC-WH1')
    expect(
      suggestBranchCode({ city: 'Accra', type: 'WAREHOUSE', existingCodes: ['ACC-WH1'] }),
    ).toEqual({ code: 'ACC-WH2', adjusted: true })
  })

  it('avoids retail collisions with a numeric suffix', () => {
    expect(
      suggestBranchCode({
        city: 'Accra',
        area: 'Spintex',
        type: 'RETAIL',
        existingCodes: ['ACC-SPX'],
      }),
    ).toEqual({ code: 'ACC-SPX-2', adjusted: true })
    expect(
      suggestBranchCode({
        city: 'Accra',
        area: 'Spintex',
        type: 'RETAIL',
        existingCodes: ['ACC-SPX', 'ACC-SPX-2'],
      }),
    ).toEqual({ code: 'ACC-SPX-3', adjusted: true })
  })
})

describe('branch code validation', () => {
  it('accepts generated shapes', () => {
    expect(isValidBranchCode('ACC-SPX')).toBe(true)
    expect(isValidBranchCode('acc-wh1')).toBe(true)
    expect(isValidBranchCode('ACC-SPX-2')).toBe(true)
    expect(isValidBranchCode('ACC-R1')).toBe(true)
    expect(isValidBranchCode('TAM-R2')).toBe(true)
  })

  it('rejects malformed codes', () => {
    expect(isValidBranchCode('')).toBe(false)
    expect(isValidBranchCode('A')).toBe(false)
    expect(isValidBranchCode('ACC SPX')).toBe(false)
    expect(isValidBranchCode('ACC--SPX')).toBe(false)
    expect(isValidBranchCode('-ACC')).toBe(false)
    expect(isValidBranchCode('ACC-SPXTN')).toBe(false)
    expect(isValidBranchCode('ACC-SPX-A-B')).toBe(false)
  })

  it('normalizes to uppercase without surrounding whitespace', () => {
    expect(normalizeBranchCode('  acc-spx ')).toBe('ACC-SPX')
  })
})
