import { BrowserWindow, session } from 'electron'
import type { CheckoutOpenResult } from '../../shared/ipc'
import {
  CHECKOUT_PARTITION,
  checkoutWindowOptions,
  isAllowedCheckoutNavigation,
  isAllowedCheckoutUrl,
} from './checkout-policy'

/**
 * The one window that ever shows a card form (P13-D13).
 *
 * Created by the main process, with no preload and a deny-everything navigation
 * policy. The renderer can open and close it; it can never read it, and it
 * learns the outcome from the server like every other electronic tender.
 *
 * A single module-level handle means opening a second checkout closes the
 * first: two live card windows at one till is two customers' money on one
 * screen.
 */

let checkoutWindow: BrowserWindow | null = null

function hardenPartition(): void {
  const partition = session.fromPartition(CHECKOUT_PARTITION)
  // The checkout needs no camera, no clipboard, no MIDI, no notifications.
  partition.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  partition.setPermissionCheckHandler(() => false)
}

export async function openCheckoutWindow(
  url: string,
  options: { parent: BrowserWindow | null; log?: (message: string) => void },
): Promise<CheckoutOpenResult> {
  if (!isAllowedCheckoutUrl(url)) return { ok: false, reason: 'UNTRUSTED_URL' }

  closeCheckoutWindow()

  const parent = options.parent
  if (!parent || parent.isDestroyed()) return { ok: false, reason: 'NO_PARENT' }

  hardenPartition()

  const window = new BrowserWindow({
    ...checkoutWindowOptions(),
    parent,
  })

  // Not even a link in the checkout may open a second window.
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  /*
   * The shell installs a global `web-contents-created` guard whose allowlist is
   * the app origin. That guard also runs on this window, and it would block
   * Paystack's own redirects (`checkout.paystack.com` → `paystack.com`), which
   * is a card payment that never loads. This window replaces those listeners
   * with its own, narrower allowlist; the deny-everything window-open handler
   * and the partition permissions stay untouched.
   */
  window.webContents.removeAllListeners('will-navigate')
  window.webContents.removeAllListeners('will-redirect')
  window.webContents.removeAllListeners('will-attach-webview')

  const guardNavigation = (event: { preventDefault(): void }, target: string): void => {
    if (!isAllowedCheckoutNavigation(target)) {
      options.log?.('checkout blocked a navigation outside the allowlist')
      event.preventDefault()
    }
  }
  window.webContents.on('will-navigate', guardNavigation)
  window.webContents.on('will-redirect', guardNavigation)
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())

  window.on('closed', () => {
    if (checkoutWindow === window) checkoutWindow = null
  })

  checkoutWindow = window

  try {
    await window.loadURL(url)
  } catch {
    // A failure to load is not a payment failure: the server still owns the
    // status, and the panel keeps polling.
    closeCheckoutWindow()
    return { ok: false, reason: 'OPEN_FAILED' }
  }

  return { ok: true }
}

export function closeCheckoutWindow(): void {
  const window = checkoutWindow
  checkoutWindow = null
  if (window && !window.isDestroyed()) window.close()
}

/** Test/diagnostic seam: is a checkout window currently open? */
export function hasCheckoutWindow(): boolean {
  return checkoutWindow !== null
}
