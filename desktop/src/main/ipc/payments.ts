import type { BrowserWindow } from 'electron'
import { z } from 'zod'
import { type CheckoutOpenResult, IPC_CHANNELS } from '../../shared/ipc'
import { closeCheckoutWindow, openCheckoutWindow } from '../payments/checkout-window'

/**
 * Checkout-window IPC (Plan 09 Task 2).
 *
 * The renderer may only say "open this URL" and "close it". The URL is
 * validated again in the main process, even though the renderer already
 * checks it: the renderer is not trusted, and this is the call that puts a
 * remote page on a till's screen.
 */

type IpcHandle = <Args extends unknown[], T>(
  channel: string,
  handler: (...args: Args) => Promise<T>,
) => void

const urlSchema = z.string().trim().min(1).max(2_048)

export function registerPaymentHandlers(
  handle: IpcHandle,
  options: {
    /** Returns the trusted main window, if it is still open. */
    mainWindow: () => BrowserWindow | null
    log?: (message: string) => void
  },
): void {
  handle(IPC_CHANNELS.checkoutOpen, async (rawUrl: unknown): Promise<CheckoutOpenResult> => {
    const url = urlSchema.parse(rawUrl)
    const result = await openCheckoutWindow(url, {
      parent: options.mainWindow(),
      log: options.log,
    })
    if (!result.ok) options.log?.(`checkout refused: ${result.reason}`)
    return result
  })

  handle(IPC_CHANNELS.checkoutClose, async () => {
    closeCheckoutWindow()
    return null
  })
}
