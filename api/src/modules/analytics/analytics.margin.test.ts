import { describe, expect, it } from 'vitest'
import { marginWhenCosted } from './analytics.service.ts'

/**
 * 17-04: a window with no cost states no margin.
 *
 * The bug this prevents is subtle and expensive: with `cost = 0` the arithmetic
 * margin is exactly 100%, which reads as "we make pure profit" on goods nobody
 * has bought yet.
 */
describe('the margin a window may state', () => {
  it('refuses a margin when every sold unit had no cost', () => {
    expect(
      marginWhenCosted({
        revenueBaseMinor: 100_000,
        costMinor: 0,
        uncostedRevenueBaseMinor: 100_000,
      }),
    ).toBeNull()
  })

  it('keeps the real margin for a fully costed window', () => {
    expect(
      marginWhenCosted({
        revenueBaseMinor: 100_000,
        costMinor: 60_000,
        uncostedRevenueBaseMinor: 0,
      }),
    ).toBe(4_000)
  })

  it('keeps a mixed window’s margin and leaves the uncosted part to the reader', () => {
    // 80 000 costed at 60 000, 20 000 uncosted: the figure is real but explains
    // only part of the revenue, which is why the amount travels with it.
    expect(
      marginWhenCosted({
        revenueBaseMinor: 100_000,
        costMinor: 60_000,
        uncostedRevenueBaseMinor: 20_000,
      }),
    ).toBe(4_000)
  })

  it('states nothing for a window with no revenue', () => {
    expect(
      marginWhenCosted({ revenueBaseMinor: 0, costMinor: 0, uncostedRevenueBaseMinor: 0 }),
    ).toBeNull()
  })
})
