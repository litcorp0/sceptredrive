import { describe, expect, it } from 'vitest'
import {
  CONFLICT_RESOLUTION_CODES,
  CONFLICT_RESOLUTION_LABELS,
  CONFLICT_SEVERITY_LABELS,
  CONFLICT_TYPE_LABELS,
  resolutionProblem,
} from './conflicts.ts'

// The names on the `sync_conflict_type` enum, in schema order. Shared cannot
// import the API's Drizzle schema, so the vocabulary is asserted here.
const CONFLICT_TYPES = [
  'STOCK_OVERSELL',
  'CREDIT_OVER_LIMIT',
  'CREDIT_HOLD',
  'LOYALTY_NEGATIVE',
  'LOYALTY_RATE_CHANGED',
  'PRICE_MISMATCH',
  'TOTAL_MISMATCH',
  'SHIFT_VARIANCE_MISMATCH',
  'STALE_CREDENTIALS',
  'OVERRIDE_INVALID',
  'DUPLICATE_CUSTOMER',
  'CLOCK_SKEW',
  'INVALID_CUSTOMER',
  'UNKNOWN_PRODUCT',
  'PAYMENT_LATE_SETTLEMENT',
  'PAYMENT_AMOUNT_MISMATCH',
  'SALE_AFTER_SHIFT_CLOSE',
] as const

describe('conflict vocabulary', () => {
  it('labels every resolution code in words', () => {
    expect(CONFLICT_RESOLUTION_CODES).toEqual([
      'CONFIRMED',
      'CORRECTED_ELSEWHERE',
      'ACCEPTED_RISK',
      'TILL_INSTRUCTION',
      'DUPLICATE',
    ])
    for (const code of CONFLICT_RESOLUTION_CODES) {
      expect(CONFLICT_RESOLUTION_LABELS[code].length).toBeGreaterThan(0)
      expect(CONFLICT_RESOLUTION_LABELS[code]).not.toBe(code)
    }
  })

  it('labels all 17 sync conflict types', () => {
    expect(CONFLICT_TYPES).toHaveLength(17)
    expect(Object.keys(CONFLICT_TYPE_LABELS)).toHaveLength(17)
    for (const type of CONFLICT_TYPES) {
      const label = CONFLICT_TYPE_LABELS[type]
      expect(label?.length).toBeGreaterThan(0)
      expect(label).not.toBe(type)
    }
  })

  it('labels the three severities', () => {
    expect(CONFLICT_SEVERITY_LABELS).toEqual({ LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High' })
  })
})

describe('resolutionProblem', () => {
  it('accepts a resolved conflict with a code and no note', () => {
    expect(resolutionProblem({ status: 'RESOLVED', code: 'CONFIRMED', note: null })).toBeNull()
  })

  it('requires a code for a resolution', () => {
    const problem = resolutionProblem({ status: 'RESOLVED', code: null, note: null })
    expect(problem).not.toBeNull()
    expect(problem).toContain('code')
  })

  it('treats a blank code as missing', () => {
    expect(resolutionProblem({ status: 'RESOLVED', code: '   ', note: null })).not.toBeNull()
  })

  it('requires a note when dismissing a conflict', () => {
    const problem = resolutionProblem({
      status: 'DISMISSED',
      code: 'ACCEPTED_RISK',
      note: null,
    })
    expect(problem).not.toBeNull()
    expect(problem).toContain('note')
    expect(
      resolutionProblem({ status: 'DISMISSED', code: 'ACCEPTED_RISK', note: '  ' }),
    ).not.toBeNull()
  })

  it('accepts a dismissed conflict with a code and a note', () => {
    expect(
      resolutionProblem({
        status: 'DISMISSED',
        code: 'ACCEPTED_RISK',
        note: 'Known and tolerated at this branch',
      }),
    ).toBeNull()
  })
})
