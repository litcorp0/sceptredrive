import path from 'node:path'
import type {
  DrawerPin,
  DrawerRequest,
  PrintEncoding,
  PrinterInfo,
  PrinterTarget,
  PrintJob,
  PrintOutcome,
  PrintRequest,
} from '../../shared/printing'
import { buildDrawerBytes, buildReceiptBytes } from './escpos'
import { listSystemPrinters, printToTarget } from './escpos-printer'
import { fakeOpenDrawer, fakePrint } from './fake-printer'

/**
 * The printer runtime (D28).
 *
 * One place decides which adapter handles a job, so the IPC layer, the settings
 * screen's test print, and the sale flow all behave the same. A missing target
 * is a business outcome (`PRINTER_NOT_CONFIGURED`), never a crash.
 */

export interface PrinterRuntime {
  receiptsDir: string
  isPackaged: boolean
  log: (message: string) => void
}

export function createPrinterRuntime(options: {
  userDataDir: string
  isPackaged: boolean
  env?: NodeJS.ProcessEnv
  log?: (message: string) => void
}): PrinterRuntime {
  const env = options.env ?? process.env
  const override = env.RECEIPTS_DIR?.trim()
  const receiptsDir =
    override && path.isAbsolute(override) ? override : path.join(options.userDataDir, 'receipts')

  return {
    receiptsDir,
    isPackaged: options.isPackaged,
    log: options.log ?? (() => {}),
  }
}

function targetProblem(target: PrinterTarget): string | null {
  if (target.driver === 'fake') return null
  if (target.driver === 'winspool' && !target.printerName?.trim()) {
    return 'Choose a Windows printer queue first'
  }
  if (target.driver === 'network' && !target.host?.trim()) {
    return 'Enter the printer network address first'
  }
  return null
}

function notConfigured(message: string): PrintOutcome {
  return { ok: false, code: 'PRINTER_NOT_CONFIGURED', message }
}

export async function printJob(
  runtime: PrinterRuntime,
  request: PrintRequest,
): Promise<PrintOutcome> {
  const problem = targetProblem(request.target)
  if (problem) return notConfigured(problem)

  if (request.target.driver === 'fake') {
    return fakePrint(runtime.receiptsDir, request.job)
  }

  const bytes = buildReceiptBytes(request.job, request.job.copies)
  return printToTarget(request.target, bytes, runtime.log)
}

export async function openDrawer(
  runtime: PrinterRuntime,
  request: DrawerRequest,
): Promise<PrintOutcome> {
  const problem = targetProblem(request.target)
  if (problem) return notConfigured(problem)

  if (request.target.driver === 'fake') {
    return fakeOpenDrawer(runtime.receiptsDir, request.drawerPin)
  }

  return printToTarget(request.target, buildDrawerBytes(request.drawerPin), runtime.log)
}

export async function listPrinters(runtime: PrinterRuntime): Promise<PrinterInfo[]> {
  const printers = await listSystemPrinters(runtime.log)
  // The fake adapter is always available, so a dev/CI terminal can still test.
  return [
    ...printers,
    {
      name: 'File output (fake printer)',
      driver: 'fake' as const,
      isDefault: printers.length === 0,
    },
  ]
}

export function testJob(encoding: PrintEncoding): PrintJob {
  const stamp = new Date().toISOString()
  const line = '='.repeat(42)
  return {
    receiptNumber: `TEST-${Date.now()}`,
    encoding,
    copies: 1,
    openDrawer: false,
    drawerPin: 2,
    lines: [
      { text: center('GikAutos POS', 42), bold: true },
      { text: center('Printer test', 42) },
      { text: line },
      { text: 'This is a test print from the terminal.' },
      { text: `Time: ${stamp}` },
      { text: '42 columns · ESC/POS · GHS 0.00' },
      { text: line },
      { text: center('If you can read this, printing works.', 42) },
    ],
  }
}

function center(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width)
  const left = Math.floor((width - text.length) / 2)
  return `${' '.repeat(left)}${text}`
}

/** Re-exported so the human checklist uses the same pin semantics. */
export type { DrawerPin }
