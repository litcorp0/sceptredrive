import { describe, expect, it } from 'vitest'
import { parseHash, screenForRoute, topLevelScreen } from './router'

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

/**
 * The outer switch (Plan 08).
 *
 * A freshly installed terminal boots with no hash. It used to fall through to the diagnostics
 * shell — a developer screen — so a shop unboxing a new till saw app versions and a keychain
 * probe instead of an enrolment field. The default is now sign-in.
 */
describe('topLevelScreen', () => {
  it('sends an empty or unknown hash to sign-in, never the shell', () => {
    expect(topLevelScreen(parseHash(''))).toBe('login')
    expect(topLevelScreen(parseHash('#'))).toBe('login')
    expect(topLevelScreen(parseHash('#/'))).toBe('login')
    expect(topLevelScreen(parseHash('#nonsense'))).toBe('login')
  })

  it('sends #login to sign-in', () => {
    expect(topLevelScreen(parseHash('#login'))).toBe('login')
  })

  it('keeps the diagnostics shell on its own named route', () => {
    expect(topLevelScreen(parseHash('#diagnostics'))).toBe('diagnostics')
    // Any other `#dev/*` path is a developer surface too, not the till.
    expect(topLevelScreen(parseHash('#dev/whatever'))).toBe('diagnostics')
  })

  it('keeps the Phase 6 spike panel and the two dev routes', () => {
    expect(topLevelScreen(parseHash('#spike'))).toBe('spike')
    expect(topLevelScreen(parseHash('#dev/sync'))).toBe('dev-sync')
    expect(topLevelScreen(parseHash('#dev/print'))).toBe('dev-print')
  })

  it('keeps the till, the shift screen, and home', () => {
    expect(topLevelScreen(parseHash('#pos'))).toBe('pos')
    expect(topLevelScreen(parseHash('#pos/tender'))).toBe('pos')
    expect(topLevelScreen(parseHash('#home'))).toBe('home')
    expect(topLevelScreen(parseHash('#shift'))).toBe('shift')
  })
})
