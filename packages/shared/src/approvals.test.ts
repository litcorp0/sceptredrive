import { describe, expect, it } from 'vitest'
import {
  APPROVAL_DECIDER_ROLE,
  APPROVAL_REASON_CODES,
  APPROVAL_TYPES,
  approvalDeciderRole,
  isApprovalReasonCode,
  isApprovalType,
  isDecided,
} from './approvals.ts'

describe('approval vocabulary', () => {
  it('declares every phase that owns a request type', () => {
    expect(APPROVAL_TYPES).toContain('PURCHASE_ORDER')
    expect(APPROVAL_TYPES).toContain('PRODUCT_CREATE')
    expect(APPROVAL_TYPES).toContain('TRANSFER_REQUEST')
    expect(APPROVAL_TYPES).toContain('STOCK_WRITE_OFF')
    expect(APPROVAL_TYPES).toContain('PRICE_CHANGE')
    expect(APPROVAL_TYPES).toContain('CREDIT_LIMIT_CHANGE')
    expect(APPROVAL_TYPES).toContain('SHIFT_VARIANCE_REVIEW')
    expect(APPROVAL_TYPES).toContain('REFUND')
  })

  it('has no duplicate types or reason codes', () => {
    expect(new Set(APPROVAL_TYPES).size).toBe(APPROVAL_TYPES.length)
    expect(new Set(APPROVAL_REASON_CODES).size).toBe(APPROVAL_REASON_CODES.length)
  })

  it('gives every type a decider, and every decider is an admin', () => {
    for (const type of APPROVAL_TYPES) {
      expect(approvalDeciderRole(type)).toBe('ADMIN')
      expect(APPROVAL_DECIDER_ROLE[type]).toBe('ADMIN')
    }
  })

  it('treats only PENDING as undecided', () => {
    expect(isDecided('PENDING')).toBe(false)
    expect(isDecided('APPROVED')).toBe(true)
    expect(isDecided('REJECTED')).toBe(true)
    expect(isDecided('WITHDRAWN')).toBe(true)
  })

  it('narrows unknown strings', () => {
    expect(isApprovalType('PURCHASE_ORDER')).toBe(true)
    expect(isApprovalType('PURCHASE')).toBe(false)
    expect(isApprovalType('')).toBe(false)

    expect(isApprovalReasonCode('OVER_THRESHOLD')).toBe(true)
    expect(isApprovalReasonCode('BECAUSE')).toBe(false)
  })
})
