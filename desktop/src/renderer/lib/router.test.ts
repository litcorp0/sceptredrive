import { describe, expect, it } from 'vitest'
import { parseHash, screenForRoute } from './router'

/**
 * The `#home` route (P10-D6, P10-D7).
 *
 * `#pos` keeps meaning *selling* everywhere it already did; `#home` is a new top-level route
 * beside it. These cases are the landing contract without a running database: sign-in and a
 * successful shift open both set `#home`, and the shell resolves that to the home page.
 */

describe('screenForRoute', () => {
  it('resolves #home to the home screen', () => {
    expect(screenForRoute(parseHash('#home'))).toBe('home')
  })

  it('keeps #pos meaning selling', () => {
    expect(screenForRoute(parseHash('#pos'))).toBe('sell')
    expect(screenForRoute(parseHash('#pos/'))).toBe('sell')
    expect(screenForRoute(parseHash(''))).toBe('sell')
  })

  it('keeps every #pos sub-screen', () => {
    expect(screenForRoute(parseHash('#pos/tender'))).toBe('tender')
    expect(screenForRoute(parseHash('#pos/receipt/sale-1'))).toBe('receipt')
    expect(screenForRoute(parseHash('#pos/sales'))).toBe('sales')
    expect(screenForRoute(parseHash('#pos/sync'))).toBe('sync')
    expect(screenForRoute(parseHash('#pos/settings'))).toBe('settings')
  })
})
