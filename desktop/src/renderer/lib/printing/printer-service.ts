import type {
  DrawerPin,
  PrintEncoding,
  PrinterInfo,
  PrinterTarget,
  PrintJob,
  PrintOutcome,
} from '../../../shared/printing'
import { DesktopApiError, DesktopUnavailableError, desktopApi } from '../desktop-api'

/**
 * The renderer side of the printer port (D28).
 *
 * Every method returns a `PrintOutcome` — a printer problem is a normal state
 * the till shows, not an exception. `DesktopUnavailableError` (plain browser,
 * unit tests) becomes `PRINTER_UNAVAILABLE`, so no caller needs a try/catch.
 */

export interface PrinterTransport {
  list(): Promise<PrinterInfo[]>
  print(target: PrinterTarget, job: PrintJob): Promise<PrintOutcome>
  openDrawer(target: PrinterTarget, pin: DrawerPin): Promise<PrintOutcome>
  test(target: PrinterTarget, encoding: PrintEncoding): Promise<PrintOutcome>
}

function unavailable(message: string): PrintOutcome {
  return { ok: false, code: 'PRINTER_UNAVAILABLE', message }
}

export const desktopPrinterTransport: PrinterTransport = {
  async list() {
    try {
      return await desktopApi.listPrinters()
    } catch (error) {
      if (error instanceof DesktopUnavailableError || error instanceof DesktopApiError) return []
      throw error
    }
  },

  async print(target, job) {
    try {
      return await desktopApi.printReceipt({ target, job })
    } catch (error) {
      if (error instanceof DesktopUnavailableError) {
        return unavailable('Printing is only available in the desktop app')
      }
      if (error instanceof DesktopApiError) {
        return unavailable('The printer request was rejected')
      }
      return unavailable('The printer could not be reached')
    }
  },

  async openDrawer(target, pin) {
    try {
      return await desktopApi.openDrawer({ target, drawerPin: pin })
    } catch (error) {
      if (error instanceof DesktopUnavailableError) {
        return unavailable('The cash drawer is only available in the desktop app')
      }
      return { ok: false, code: 'DRAWER_FAILED', message: 'The cash drawer did not open' }
    }
  },

  async test(target, encoding) {
    try {
      return await desktopApi.testPrint({ target, encoding })
    } catch (error) {
      if (error instanceof DesktopUnavailableError) {
        return unavailable('Printing is only available in the desktop app')
      }
      return unavailable('The test print could not be sent')
    }
  },
}
