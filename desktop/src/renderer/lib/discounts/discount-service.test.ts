import { describe, expect, it } from 'vitest'
import {
  allowedDiscountMinor,
  capPercentFor,
  discountAmountFromInput,
  discountAuthority,
  formatPercent,
} from './discount-service'

const CAPS = { maxCashierDiscountPercent: 0, maxManagerDiscountPercent: 100 }

describe('capPercentFor', () => {
  it('gives managers and admins the manager cap', () => {
    expect(capPercentFor('MANAGER', CAPS)).toBe(100)
    expect(capPercentFor('ADMIN', CAPS)).toBe(100)
    expect(capPercentFor('CASHIER', CAPS)).toBe(0)
  })
})

describe('discountAuthority', () => {
  it('flags any cashier discount when the cashier cap is 0%', () => {
    const authority = discountAuthority({
      role: 'CASHIER',
      totalDiscountMinor: 1,
      grossMinor: 10_000,
      caps: CAPS,
      hasApproval: false,
    })
    // The floored percentage is 0, but one pesewa is still more than the
    // allowance of zero — the pesewa comparison is what decides.
    expect(authority.percent).toBe(0)
    expect(authority.requiresApproval).toBe(true)
    expect(authority.overByMinor).toBe(1)
  })

  it('measures total discounts over gross, including line discounts', () => {
    const authority = discountAuthority({
      role: 'CASHIER',
      totalDiscountMinor: 1_500,
      grossMinor: 10_000,
      caps: { maxCashierDiscountPercent: 10, maxManagerDiscountPercent: 100 },
      hasApproval: false,
    })
    expect(authority.percent).toBe(15)
    expect(authority.requiresApproval).toBe(true)
    expect(authority.overByPercent).toBe(5)
    expect(authority.overByMinor).toBe(500)
    expect(authority.approved).toBe(false)
  })

  it('allows a discount exactly at the cap', () => {
    const authority = discountAuthority({
      role: 'CASHIER',
      totalDiscountMinor: 1_000,
      grossMinor: 10_000,
      caps: { maxCashierDiscountPercent: 10, maxManagerDiscountPercent: 100 },
      hasApproval: false,
    })
    expect(authority.percent).toBe(10)
    expect(authority.requiresApproval).toBe(false)
    expect(authority.approved).toBe(true)
  })

  it('requires approval one pesewa over the cap boundary', () => {
    // At a 10% cap of 10,000 the allowance is 1,000 pesewas. One pesewa over is
    // over the cap even though the floored percentage still reads 10%.
    const authority = discountAuthority({
      role: 'CASHIER',
      totalDiscountMinor: 1_001,
      grossMinor: 10_000,
      caps: { maxCashierDiscountPercent: 10, maxManagerDiscountPercent: 100 },
      hasApproval: false,
    })
    expect(authority.percent).toBe(10)
    expect(authority.requiresApproval).toBe(true)
    expect(authority.overByMinor).toBe(1)
  })

  it('treats an approved over-cap discount as allowed', () => {
    const authority = discountAuthority({
      role: 'CASHIER',
      totalDiscountMinor: 5_000,
      grossMinor: 10_000,
      caps: CAPS,
      hasApproval: true,
    })
    expect(authority.requiresApproval).toBe(true)
    expect(authority.approved).toBe(true)
  })

  it('lets a manager discount up to the manager cap without approval', () => {
    const authority = discountAuthority({
      role: 'MANAGER',
      totalDiscountMinor: 10_000,
      grossMinor: 10_000,
      caps: CAPS,
      hasApproval: false,
    })
    expect(authority.percent).toBe(100)
    expect(authority.requiresApproval).toBe(false)
  })

  it('is quiet on an empty cart', () => {
    const authority = discountAuthority({
      role: 'CASHIER',
      totalDiscountMinor: 0,
      grossMinor: 0,
      caps: CAPS,
      hasApproval: false,
    })
    expect(authority.percent).toBe(0)
    expect(authority.requiresApproval).toBe(false)
  })
})

describe('allowedDiscountMinor', () => {
  it('floors the allowance', () => {
    expect(allowedDiscountMinor(10_000, 10)).toBe(1_000)
    expect(allowedDiscountMinor(10_001, 10)).toBe(1_000)
    expect(allowedDiscountMinor(10_000, 0)).toBe(0)
  })
})

describe('discountAmountFromInput', () => {
  it('parses a cedi amount into pesewas', () => {
    expect(discountAmountFromInput('12.50', 'AMOUNT', 10_000)).toBe(1_250)
    expect(discountAmountFromInput('12', 'AMOUNT', 10_000)).toBe(1_200)
  })

  it('clamps an amount to the base', () => {
    expect(discountAmountFromInput('999', 'AMOUNT', 10_000)).toBe(10_000)
  })

  it('rejects an invalid amount', () => {
    expect(discountAmountFromInput('12.345', 'AMOUNT', 10_000)).toBeNull()
    expect(discountAmountFromInput('-5', 'AMOUNT', 10_000)).toBeNull()
    expect(discountAmountFromInput('abc', 'AMOUNT', 10_000)).toBeNull()
  })

  it('converts a percentage with a floor', () => {
    expect(discountAmountFromInput('10', 'PERCENT', 10_000)).toBe(1_000)
    expect(discountAmountFromInput('33', 'PERCENT', 1_000)).toBe(330)
    expect(discountAmountFromInput('10%', 'PERCENT', 10_000)).toBe(1_000)
  })

  it('rejects a percentage above 100 or a fraction', () => {
    expect(discountAmountFromInput('101', 'PERCENT', 10_000)).toBeNull()
    expect(discountAmountFromInput('10.5', 'PERCENT', 10_000)).toBeNull()
  })

  it('never exceeds the base', () => {
    expect(discountAmountFromInput('100', 'PERCENT', 333)).toBe(333)
  })
})

describe('formatPercent', () => {
  it('floors and clamps', () => {
    expect(formatPercent(12.9)).toBe('12%')
    expect(formatPercent(-3)).toBe('0%')
  })
})
