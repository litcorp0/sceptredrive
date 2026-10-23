import { describe, expect, it } from 'vitest'
import {
  buildCustomerSearchQuery,
  CUSTOMER_SEARCH_LIMIT,
  phoneDigits,
  phoneMatchDigits,
} from './search'

describe('phone digits', () => {
  it('keeps only digits', () => {
    expect(phoneDigits('+233 24 123 4567')).toBe('233241234567')
    expect(phoneDigits('024-123-4567')).toBe('0241234567')
  })

  it('drops leading zeros so a national number matches E.164', () => {
    expect(phoneMatchDigits('0241234567')).toBe('241234567')
    expect(phoneMatchDigits('+233241234567')).toBe('233241234567')
    expect(phoneMatchDigits('0')).toBe('')
  })
})

describe('buildCustomerSearchQuery', () => {
  it('binds the term instead of interpolating it', () => {
    const query = buildCustomerSearchQuery("O'Brien")
    expect(query.sql).not.toContain("O'Brien")
    expect(query.parameters).toContain("O'Brien")
  })

  it('escapes LIKE wildcards in the name pattern', () => {
    const query = buildCustomerSearchQuery('100%')
    expect(query.parameters[1]).toBe('%100\\%%')
  })

  it('searches only active, non-anonymized customers', () => {
    const query = buildCustomerSearchQuery('ama')
    expect(query.sql).toContain("status = 'ACTIVE'")
    expect(query.sql).toContain('anonymized_at IS NULL')
  })

  it('searches the phone by digits', () => {
    const query = buildCustomerSearchQuery('0241234567')
    expect(query.parameters[2]).toBe('%241234567%')
  })

  it('caps the result set', () => {
    expect(buildCustomerSearchQuery('a').parameters.at(-1)).toBe(CUSTOMER_SEARCH_LIMIT)
    expect(buildCustomerSearchQuery('a', 5).parameters.at(-1)).toBe(5)
  })

  it('binds as many parameters as it has placeholders', () => {
    const query = buildCustomerSearchQuery('ama')
    expect((query.sql.match(/\?/g) ?? []).length).toBe(query.parameters.length)
  })
})
