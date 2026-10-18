import { describe, expect, it } from 'vitest'
import { formatGhanaPhone, normalizeGhanaPhone } from './phone.ts'

describe('normalizeGhanaPhone', () => {
  it('normalizes national, international, and spaced formats to E.164', () => {
    expect(normalizeGhanaPhone('0241234567')).toBe('+233241234567')
    expect(normalizeGhanaPhone('024 123 4567')).toBe('+233241234567')
    expect(normalizeGhanaPhone('024-123-4567')).toBe('+233241234567')
    expect(normalizeGhanaPhone('233241234567')).toBe('+233241234567')
    expect(normalizeGhanaPhone('+233 24 123 4567')).toBe('+233241234567')
    expect(normalizeGhanaPhone('  +233241234567  ')).toBe('+233241234567')
  })

  it('normalizes a second mobile range', () => {
    expect(normalizeGhanaPhone('0541234567')).toBe('+233541234567')
  })

  it('rejects invalid and non-Ghana numbers', () => {
    expect(normalizeGhanaPhone('')).toBeNull()
    expect(normalizeGhanaPhone('   ')).toBeNull()
    expect(normalizeGhanaPhone('02412345')).toBeNull()
    expect(normalizeGhanaPhone('0123456789')).toBeNull()
    expect(normalizeGhanaPhone('+441234567890')).toBeNull()
    expect(normalizeGhanaPhone('not a phone')).toBeNull()
  })
})

describe('formatGhanaPhone', () => {
  it('formats E.164 numbers in national form', () => {
    expect(formatGhanaPhone('+233241234567')).toBe('024 123 4567')
  })

  it('returns unparseable values unchanged', () => {
    expect(formatGhanaPhone('junk')).toBe('junk')
  })
})
