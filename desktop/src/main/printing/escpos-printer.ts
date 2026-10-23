import type * as NodePrinterModule from '@maxxuxx/node-printer'
import type { PrinterInfo, PrinterTarget, PrintOutcome } from '../../shared/printing'

/**
 * The real ESC/POS adapter (D28).
 *
 * `@maxxuxx/node-printer` is imported dynamically so a missing native prebuild
 * degrades to `PRINTER_UNAVAILABLE` instead of preventing the app from booting.
 * Nothing from the underlying error is returned to the renderer: only a stable
 * code and a human message. The code is logged in the main process.
 */

type PrinterModule = typeof NodePrinterModule

async function loadPrinter(): Promise<PrinterModule | null> {
  try {
    return await import('@maxxuxx/node-printer')
  } catch {
    return null
  }
}

function toLibraryTarget(
  target: PrinterTarget,
): NodePrinterModule.NetworkPrinterTarget | NodePrinterModule.WinspoolPrinterTarget {
  if (target.driver === 'network') {
    return {
      type: 'network',
      host: target.host ?? '',
      port: target.port ?? 9100,
      timeoutMs: 5_000,
    }
  }
  return { type: 'winspool', printerName: target.printerName ?? '' }
}

/** Maps a library error to a stable outcome without leaking internals. */
function toOutcome(error: unknown, drawer: boolean): PrintOutcome {
  const rawCode =
    error && typeof error === 'object' && 'code' in error ? String(error.code) : 'UNKNOWN'

  if (rawCode === 'ERR_UNSUPPORTED_PLATFORM') {
    return {
      ok: false,
      code: 'PRINTER_UNSUPPORTED',
      message: 'This printer type is not supported on this platform',
    }
  }
  if (rawCode === 'ERR_NATIVE_MODULE_UNAVAILABLE') {
    return {
      ok: false,
      code: 'PRINTER_UNAVAILABLE',
      message: 'The printer driver is not available on this terminal',
    }
  }
  if (
    rawCode === 'ERR_CONNECTION_TIMEOUT' ||
    rawCode === 'ERR_WRITE_TIMEOUT' ||
    rawCode === 'ERR_INVALID_TARGET'
  ) {
    return {
      ok: false,
      code: 'PRINTER_UNAVAILABLE',
      message: 'The printer could not be reached',
    }
  }
  if (drawer) {
    return {
      ok: false,
      code: 'DRAWER_FAILED',
      message: 'The cash drawer did not open',
    }
  }
  return {
    ok: false,
    code: 'PRINTER_FAILED',
    message: 'The printer did not accept the job',
  }
}

export async function printToTarget(
  target: PrinterTarget,
  bytes: Uint8Array,
  log: (message: string) => void = () => {},
): Promise<PrintOutcome> {
  if (target.driver === 'fake') {
    return {
      ok: false,
      code: 'PRINTER_UNAVAILABLE',
      message: 'The fake printer is handled without the native adapter',
    }
  }

  const module = await loadPrinter()
  if (!module) {
    return {
      ok: false,
      code: 'PRINTER_UNAVAILABLE',
      message: 'The printer driver is not available on this terminal',
    }
  }

  try {
    await module.print(toLibraryTarget(target), bytes)
    return { ok: true, bytes: bytes.length }
  } catch (error) {
    const outcome = toOutcome(error, false)
    log(`printer: ${target.driver} failed (${outcome.ok ? 'ok' : outcome.code})`)
    return outcome
  }
}

export async function listSystemPrinters(
  log: (message: string) => void = () => {},
): Promise<PrinterInfo[]> {
  const module = await loadPrinter()
  if (!module) return []

  try {
    if (process.platform === 'win32') {
      const printers = await module.listPrinters('winspool')
      return printers.map((printer) => ({
        name: printer.name,
        driver: 'winspool' as const,
        isDefault: Boolean(printer.isDefault),
      }))
    }
    const printers = await module.listPrinters('cups')
    return printers.map((printer) => ({
      name: printer.name,
      driver: 'cups' as const,
      isDefault: Boolean(printer.isDefault),
    }))
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '?'
    log(`printer: list failed (${code})`)
    return []
  }
}
