import { describe, expect, it } from 'vitest'
import {
  APPROVAL_DECIDER_ROLE,
  APPROVAL_REASON_CODES,
  APPROVAL_TYPES,
  canDecideApproval,
  defaultApprovalAuthority,
  isApprovalReasonCode,
  isApprovalType,
  isDecided,
} from './approvals.ts'

const BRANCH_A = '0b000000-0000-4000-8000-00000000000a'
const BRANCH_B = '0b000000-0000-4000-8000-00000000000b'

const REQUESTER = 'Ama (manager, Accra)'
const DECIDER = 'Kofi (manager, Accra)'

function pendingApproval(
  overrides: Partial<{
    status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN'
    deciderRole: 'ADMIN' | 'MANAGER' | 'CASHIER'
    deciderBranchId: string | null
    requestedBy: string
  }> = {},
) {
  return {
    status: 'PENDING' as const,
    deciderRole: 'MANAGER' as const,
    deciderBranchId: BRANCH_A,
    requestedBy: REQUESTER,
    ...overrides,
  }
}

function actor(
  overrides: Partial<{
    role: 'ADMIN' | 'MANAGER' | 'CASHIER'
    branchId: string | null
    label: string
    hasDecidePermission: boolean
  }> = {},
) {
  return {
    role: 'MANAGER' as const,
    branchId: BRANCH_A,
    label: DECIDER,
    hasDecidePermission: true,
    ...overrides,
  }
}

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

  it('gives every type a decider role, and only ADMIN or MANAGER', () => {
    for (const type of APPROVAL_TYPES) {
      expect(['ADMIN', 'MANAGER']).toContain(APPROVAL_DECIDER_ROLE[type])
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

describe('defaultApprovalAuthority', () => {
  it('binds a manager decision to the branch that owns the subject', () => {
    expect(defaultApprovalAuthority('TRANSFER_REQUEST', BRANCH_A)).toEqual({
      role: 'MANAGER',
      branchId: BRANCH_A,
    })
    expect(defaultApprovalAuthority('SHIFT_VARIANCE_REVIEW', BRANCH_B)).toEqual({
      role: 'MANAGER',
      branchId: BRANCH_B,
    })
  })

  it('leaves an admin decision unbound from any branch', () => {
    expect(defaultApprovalAuthority('PURCHASE_ORDER', BRANCH_A)).toEqual({
      role: 'ADMIN',
      branchId: null,
    })
    expect(defaultApprovalAuthority('REFUND', BRANCH_B)).toEqual({ role: 'ADMIN', branchId: null })
  })

  it('returns a role for every type, even without a branch', () => {
    for (const type of APPROVAL_TYPES) {
      const authority = defaultApprovalAuthority(type, null)
      expect(['ADMIN', 'MANAGER']).toContain(authority.role)
      if (authority.role === 'ADMIN') expect(authority.branchId).toBeNull()
    }
  })
})

describe('canDecideApproval', () => {
  it('lets an admin decide an admin row in another branch', () => {
    expect(
      canDecideApproval({
        approval: pendingApproval({ deciderRole: 'ADMIN', deciderBranchId: null }),
        user: actor({ role: 'ADMIN', branchId: BRANCH_B }),
      }),
    ).toBe(true)
  })

  it('lets an admin decide a manager row in a branch that is not theirs', () => {
    expect(
      canDecideApproval({
        approval: pendingApproval({ deciderBranchId: BRANCH_A }),
        user: actor({ role: 'ADMIN', branchId: BRANCH_B }),
      }),
    ).toBe(true)
  })

  it('refuses anyone deciding their own request, admin included', () => {
    expect(
      canDecideApproval({
        approval: pendingApproval({
          deciderRole: 'ADMIN',
          deciderBranchId: null,
          requestedBy: 'Adwoa (admin)',
        }),
        user: actor({ role: 'ADMIN', label: 'Adwoa (admin)' }),
      }),
    ).toBe(false)
  })

  it('lets a manager decide a manager row in their own branch', () => {
    expect(
      canDecideApproval({
        approval: pendingApproval(),
        user: actor(),
      }),
    ).toBe(true)
  })

  it('refuses a manager deciding a manager row in another branch', () => {
    expect(
      canDecideApproval({
        approval: pendingApproval({ deciderBranchId: BRANCH_A }),
        user: actor({ branchId: BRANCH_B }),
      }),
    ).toBe(false)
  })

  it('refuses a manager deciding an admin row, even in their own branch', () => {
    expect(
      canDecideApproval({
        approval: pendingApproval({ deciderRole: 'ADMIN', deciderBranchId: null }),
        user: actor(),
      }),
    ).toBe(false)
  })

  it('refuses a manager authority with no branch — it is undecidable, not open', () => {
    expect(
      canDecideApproval({
        approval: pendingApproval({ deciderBranchId: null }),
        user: actor(),
      }),
    ).toBe(false)
  })

  it('refuses a manager who does not hold approval.decide', () => {
    expect(
      canDecideApproval({
        approval: pendingApproval(),
        user: actor({ hasDecidePermission: false }),
      }),
    ).toBe(false)
  })

  it('refuses every decided row', () => {
    for (const status of ['APPROVED', 'REJECTED', 'WITHDRAWN'] as const) {
      expect(
        canDecideApproval({
          approval: pendingApproval({ status }),
          user: actor(),
        }),
      ).toBe(false)
    }
  })

  it('refuses a cashier, who holds no admin permissions', () => {
    expect(
      canDecideApproval({
        approval: pendingApproval(),
        user: actor({ role: 'CASHIER', hasDecidePermission: false }),
      }),
    ).toBe(false)
  })

  it('agrees with the default authority for a branch request', () => {
    const authority = defaultApprovalAuthority('TRANSFER_REQUEST', BRANCH_A)
    expect(
      canDecideApproval({
        approval: pendingApproval({
          deciderRole: authority.role,
          deciderBranchId: authority.branchId,
        }),
        user: actor({ branchId: BRANCH_A }),
      }),
    ).toBe(true)
  })
})
