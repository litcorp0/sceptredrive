import { describe, expect, it } from 'vitest'
import {
  canApplyOrderAction,
  goodsValueMinor,
  orderFulfilment,
  requiresApproval,
} from './procurement.ts'

describe('goodsValueMinor', () => {
  it('sums quantity × unit cost', () => {
    expect(
      goodsValueMinor([
        { quantity: 10, unitCostMinor: 5000 },
        { quantity: 3, unitCostMinor: 1200 },
      ]),
    ).toBe(53_600)
  })

  it('is zero for no lines', () => {
    expect(goodsValueMinor([])).toBe(0)
  })

  it('rejects a zero or negative quantity', () => {
    expect(() => goodsValueMinor([{ quantity: 0, unitCostMinor: 100 }])).toThrow(TypeError)
    expect(() => goodsValueMinor([{ quantity: -1, unitCostMinor: 100 }])).toThrow(TypeError)
    expect(() => goodsValueMinor([{ quantity: 1.5, unitCostMinor: 100 }])).toThrow(TypeError)
  })

  it('rejects a negative or fractional cost', () => {
    expect(() => goodsValueMinor([{ quantity: 1, unitCostMinor: -1 }])).toThrow(TypeError)
    expect(() => goodsValueMinor([{ quantity: 1, unitCostMinor: 0.5 }])).toThrow(TypeError)
  })

  it('refuses to overflow a safe integer', () => {
    expect(() =>
      goodsValueMinor([
        { quantity: 1_000_000, unitCostMinor: 100_000_000_000 },
        { quantity: 1_000_000, unitCostMinor: 100_000_000_000 },
      ]),
    ).toThrow(TypeError)
  })
})

describe('requiresApproval', () => {
  const threshold = 1_000_000

  it('lets a value below the limit through', () => {
    expect(requiresApproval(999_999, threshold)).toBe(false)
    expect(requiresApproval(0, threshold)).toBe(false)
  })

  it('requires a decision at exactly the limit and above', () => {
    expect(requiresApproval(1_000_000, threshold)).toBe(true)
    expect(requiresApproval(1_000_001, threshold)).toBe(true)
  })

  it('requires a decision for anything when the limit is zero', () => {
    expect(requiresApproval(0, 0)).toBe(true)
  })

  it('rejects negative or non-integer input', () => {
    expect(() => requiresApproval(-1, threshold)).toThrow(TypeError)
    expect(() => requiresApproval(1, 1.5)).toThrow(TypeError)
  })
})

describe('canApplyOrderAction', () => {
  const allowed: Array<[Parameters<typeof canApplyOrderAction>[0], string[]]> = [
    ['DRAFT', ['submit', 'cancel']],
    ['PENDING_APPROVAL', ['cancel']],
    ['APPROVED', ['send', 'receive', 'close', 'cancel']],
    ['SENT', ['receive', 'close', 'cancel']],
    ['PARTIALLY_RECEIVED', ['receive', 'close']],
    ['RECEIVED', ['close']],
    ['REJECTED', []],
    ['CLOSED', []],
    ['CANCELLED', []],
  ]

  it('matches the transition table row by row', () => {
    for (const [status, actions] of allowed) {
      for (const action of ['submit', 'send', 'receive', 'close', 'cancel'] as const) {
        expect(canApplyOrderAction(status, action)).toBe(actions.includes(action))
      }
    }
  })

  it('never sends an order that was not approved', () => {
    expect(canApplyOrderAction('DRAFT', 'send')).toBe(false)
    expect(canApplyOrderAction('PENDING_APPROVAL', 'send')).toBe(false)
    expect(canApplyOrderAction('REJECTED', 'send')).toBe(false)
  })

  it('never receives against a draft, a rejected order, or a closed one', () => {
    expect(canApplyOrderAction('DRAFT', 'receive')).toBe(false)
    expect(canApplyOrderAction('PENDING_APPROVAL', 'receive')).toBe(false)
    expect(canApplyOrderAction('REJECTED', 'receive')).toBe(false)
    expect(canApplyOrderAction('CLOSED', 'receive')).toBe(false)
    expect(canApplyOrderAction('CANCELLED', 'receive')).toBe(false)
  })

  it('does not cancel an order that has started arriving', () => {
    expect(canApplyOrderAction('PARTIALLY_RECEIVED', 'cancel')).toBe(false)
    expect(canApplyOrderAction('RECEIVED', 'cancel')).toBe(false)
  })
})

describe('orderFulfilment', () => {
  it('reports nothing received', () => {
    expect(
      orderFulfilment([
        { ordered: 10, received: 0 },
        { ordered: 5, received: 0 },
      ]),
    ).toEqual({ anyReceived: false, allReceived: false, overReceived: false })
  })

  it('reports a partial delivery', () => {
    expect(
      orderFulfilment([
        { ordered: 10, received: 6 },
        { ordered: 5, received: 0 },
      ]),
    ).toEqual({ anyReceived: true, allReceived: false, overReceived: false })
  })

  it('reports a complete delivery', () => {
    expect(orderFulfilment([{ ordered: 10, received: 10 }])).toEqual({
      anyReceived: true,
      allReceived: true,
      overReceived: false,
    })
  })

  it('reports an over-delivery without hiding the rest', () => {
    expect(
      orderFulfilment([
        { ordered: 10, received: 11 },
        { ordered: 5, received: 5 },
      ]),
    ).toEqual({ anyReceived: true, allReceived: true, overReceived: true })
  })

  it('treats an empty order as not fulfilled', () => {
    expect(orderFulfilment([])).toEqual({
      anyReceived: false,
      allReceived: false,
      overReceived: false,
    })
  })

  it('rejects nonsense quantities', () => {
    expect(() => orderFulfilment([{ ordered: 0, received: 0 }])).toThrow(TypeError)
    expect(() => orderFulfilment([{ ordered: 1, received: -1 }])).toThrow(TypeError)
  })
})
