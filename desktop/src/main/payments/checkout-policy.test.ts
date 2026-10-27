import { describe, expect, it } from 'vitest'
import {
  CHECKOUT_PARTITION,
  CHECKOUT_WEB_PREFERENCES,
  checkoutWindowOptions,
  isAllowedCheckoutNavigation,
  isAllowedCheckoutUrl,
} from './checkout-policy'

/**
 * The card window's security is its options object plus this allowlist. Both
 * are asserted here because neither can be checked by looking at a checkout
 * page, and a regression in either is a card form with a way out.
 */

describe('checkout URL guard', () => {
  it.each([
    'https://checkout.paystack.com/abc123',
    'https://paystack.com/pay/abc123',
    'https://api.paystack.co/transaction/verify/abc123',
  ])('accepts %s', (url) => {
    expect(isAllowedCheckoutUrl(url)).toBe(true)
  })

  it.each([
    ['http://checkout.paystack.com/abc123', 'plain http'],
    ['https://evil.example/abc123', 'a foreign host'],
    ['app://sceptre-drive/index.html', 'our own origin'],
    ['https://checkout.paystack.com.evil.example/abc', 'a host that starts with the right name'],
    ['https://paystack.com@evil.example/abc', 'userinfo disguise'],
    ['javascript:alert(1)', 'a non-URL scheme'],
    ['not a url', 'garbage'],
  ])('rejects %s (%s)', (url) => {
    expect(isAllowedCheckoutUrl(url)).toBe(false)
  })

  it('does not let the checkout window navigate to the JSON API host', () => {
    expect(isAllowedCheckoutNavigation('https://checkout.paystack.com/pay')).toBe(true)
    expect(isAllowedCheckoutNavigation('https://paystack.com/pay')).toBe(true)
    expect(isAllowedCheckoutNavigation('https://api.paystack.co/transaction')).toBe(false)
    expect(isAllowedCheckoutNavigation('https://evil.example/')).toBe(false)
  })
})

describe('checkout window options', () => {
  const options = checkoutWindowOptions()

  it('has the six non-negotiable switches and no preload', () => {
    expect(options.webPreferences).toMatchObject({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      partition: CHECKOUT_PARTITION,
    })
    expect('preload' in options.webPreferences).toBe(false)
    expect(CHECKOUT_WEB_PREFERENCES.nodeIntegrationInSubFrames).toBe(false)
    expect(CHECKOUT_WEB_PREFERENCES.webviewTag).toBe(false)
  })

  it('is a normal-sized, non-modal child window with no menu', () => {
    expect(options).toMatchObject({
      width: 900,
      height: 760,
      modal: false,
      autoHideMenuBar: true,
    })
  })
})
