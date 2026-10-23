import { createReceipt, type ReceiptEncoding } from '@maxxuxx/node-printer'
import type { DrawerPin, PrintJob, PrintLine } from '../../shared/printing'

/**
 * ESC/POS byte construction (D27/D28).
 *
 * Pure and native-free: it only builds a byte stream. Sending it to a printer
 * is `escpos-printer.ts`, so the exact bytes can be asserted in CI without
 * hardware.
 *
 * Layout is already decided by the renderer (`toEscPosLines`), so this module
 * only emits rows, feed, the drawer kick, and the cut. Keeping the text model
 * in the renderer means the screen preview and the paper receipt cannot drift.
 */

export const RECEIPT_COLUMNS = 42

function appendLine(receipt: ReturnType<typeof createReceipt>, line: PrintLine): void {
  if (line.bold) {
    receipt.bold(true).text(line.text).bold(false)
    return
  }
  receipt.text(line.text)
}

/**
 * One receipt block: initialize → rows → feed → optional drawer kick → cut.
 *
 * The drawer command precedes the cut so the plain ESC/POS file still ends
 * with the cut sequence (the verification hook asserts that).
 */
export function buildReceiptBytes(
  job: Pick<PrintJob, 'lines' | 'encoding' | 'openDrawer' | 'drawerPin'>,
  copies = 1,
): Uint8Array {
  const receipt = createReceipt({
    columns: RECEIPT_COLUMNS,
    encoding: job.encoding as ReceiptEncoding,
  }).initialize()

  for (const line of job.lines) {
    appendLine(receipt, line)
  }

  receipt.feed(3)
  if (job.openDrawer) {
    receipt.cashDrawer({ pin: job.drawerPin })
  }
  receipt.cut('full')

  const block = receipt.encode()
  if (copies <= 1) return block

  const combined = new Uint8Array(block.length * copies)
  for (let copy = 0; copy < copies; copy += 1) {
    combined.set(block, copy * block.length)
  }
  return combined
}

/** A standalone drawer kick (`ESC p m t1 t2`), for when printing failed. */
export function buildDrawerBytes(pin: DrawerPin): Uint8Array {
  return createReceipt({ columns: RECEIPT_COLUMNS }).initialize().cashDrawer({ pin }).encode()
}

/**
 * The exact drawer sequence for the configured pin, so tests and the human
 * checklist can assert it without decoding the whole stream.
 * `pin 2` = `0x00`, `pin 5` = `0x01`; on 50, off 250 (ESC p m 50 250).
 */
export function drawerKickBytes(pin: DrawerPin): number[] {
  return [0x1b, 0x70, pin === 5 ? 0x01 : 0x00, 50, 250]
}

export function textLineBytes(lines: readonly string[]): Buffer {
  return Buffer.from(`${lines.join('\n')}\n`, 'utf8')
}
