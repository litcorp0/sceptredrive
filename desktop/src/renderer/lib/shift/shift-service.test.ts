import { describe, expect, it } from 'vitest'
import { closeAuthority, computeExpectedCash, computeVariance } from './shift-service'

/**
 * Expected cash (P13-D32).
 *
 * The drawer formula has to net off a settled cash refund: the money is gone
 * from the till even though no sale in the shift ever paid it back in. A
 * refund that never used cash must change nothing.
 */

describe('computeExpectedCash', () => {
  it('subtracts a settled cash refund from the drawer it left', () => {
    const expected = computeExpectedCash({
      openingFloatMinor: 20_000,
      cashTendersMinor: 180_000,
      changeMinor: 0,
      cashInMinor: 10_000,
      cashOutMinor: 0,
      cashRefundsMinor: 50_000,
      cashRepaymentsMinor: 0,
    })

    // 20 000 + 180 000 − 0 + 10 000 − 0 − 50 000
    expect(expected).toBe(160_000)
    expect(
      computeVariance(160_000, expected),
      'a drawer counted at the formula disagrees by nothing',
    ).toBe(0)
  })

  it('leaves the drawer alone when the shift paid no cash refund', () => {
    expect(
      computeExpectedCash({
        openingFloatMinor: 20_000,
        cashTendersMinor: 180_000,
        changeMinor: 0,
        cashInMinor: 10_000,
        cashOutMinor: 0,
        cashRefundsMinor: 0,
        cashRepaymentsMinor: 0,
      }),
    ).toBe(210_000)
  })
})

/**
 * Who may close a drawer (P14-D12).
 *
 * Phase 13's `closeShift` refused anyone but the shift's cashier, so a manager
 * could only close their own drawer even though the server has honoured
 * `closedBy` since Plan 13. The rule now: the cashier who opened it, or a
 * manager/admin signed in on this terminal's branch. Everything else is
 * `NOT_OWNER`, unchanged.
 */

const DRAWER = { cashierUserId: 'user-ama', branchId: 'branch-accra' }
const TERMINAL_BRANCH = 'branch-accra'

describe('closeAuthority', () => {
  it('lets the cashier close the drawer they opened', () => {
    expect(closeAuthority(DRAWER, { userId: 'user-ama', role: 'CASHIER' }, TERMINAL_BRANCH)).toBe(
      'CASHIER',
    )
  })

  it('lets a manager of this branch take a cashier’s drawer over', () => {
    expect(closeAuthority(DRAWER, { userId: 'user-kofi', role: 'MANAGER' }, TERMINAL_BRANCH)).toBe(
      'MANAGER',
    )
  })

  it('lets an admin do the same, because the API does', () => {
    expect(closeAuthority(DRAWER, { userId: 'user-adjoa', role: 'ADMIN' }, TERMINAL_BRANCH)).toBe(
      'MANAGER',
    )
  })

  it('refuses a cashier closing another cashier’s drawer', () => {
    expect(
      closeAuthority(DRAWER, { userId: 'user-esinam', role: 'CASHIER' }, TERMINAL_BRANCH),
    ).toBeNull()
  })

  it('refuses a manager when the shift is not this branch’s', () => {
    // A shift row can only reach this terminal through the terminal-scoped read;
    // if one ever does from another branch, the manager does not inherit it.
    expect(
      closeAuthority(
        { ...DRAWER, branchId: 'branch-kumasi' },
        { userId: 'user-kofi', role: 'MANAGER' },
        TERMINAL_BRANCH,
      ),
    ).toBeNull()
  })
})
