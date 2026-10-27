/**
 * The checkout window's policy, kept free of Electron so it can be tested.
 *
 * The card tender is Paystack Checkout in a window our renderer never touches
 * (P13-D13). That window is still a browser, and a browser holding a card form
 * is the one place a hostile URL matters: the guard below is the whole
 * allowlist, and it is exact-host rather than `startsWith`, because
 * `https://checkout.paystack.com.evil.example` begins with the right string.
 */

export const CHECKOUT_PARTITION = 'persist:paystack-checkout'

/** Hosts the server is allowed to send us an `authorization_url` for. */
export const CHECKOUT_HOSTS = ['checkout.paystack.com', 'paystack.com', 'api.paystack.co'] as const

/** Where the checkout window itself may navigate (the API host serves JSON, not a page). */
export const CHECKOUT_NAVIGATION_HOSTS = ['checkout.paystack.com', 'paystack.com'] as const

function allowedHost(hosts: readonly string[], raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  if (url.username || url.password) return false
  // `URL` lowercases the host; compare the parsed value, never the raw string.
  return hosts.some((host) => url.hostname === host)
}

export function isAllowedCheckoutUrl(raw: string): boolean {
  return allowedHost(CHECKOUT_HOSTS, raw)
}

export function isAllowedCheckoutNavigation(raw: string): boolean {
  return allowedHost(CHECKOUT_NAVIGATION_HOSTS, raw)
}

/**
 * The web preferences of the checkout window. There is deliberately **no
 * `preload`**: the page can reach no IPC, and therefore no device token, no
 * keychain, and no printer. `partition` is persistent so the customer is not
 * asked for a fresh checkout session on every card tender; it holds only
 * Paystack's own cookies, never ours.
 */
export const CHECKOUT_WEB_PREFERENCES = {
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false,
  webSecurity: true,
  webviewTag: false,
  allowRunningInsecureContent: false,
  experimentalFeatures: false,
  spellcheck: false,
  devTools: false,
  partition: CHECKOUT_PARTITION,
} as const

export interface CheckoutWindowOptions {
  width: number
  height: number
  modal: boolean
  autoHideMenuBar: boolean
  webPreferences: typeof CHECKOUT_WEB_PREFERENCES
}

/** The static part of the options; the window module adds the parent. */
export function checkoutWindowOptions(): CheckoutWindowOptions {
  return {
    width: 900,
    height: 760,
    modal: false,
    autoHideMenuBar: true,
    webPreferences: CHECKOUT_WEB_PREFERENCES,
  }
}
