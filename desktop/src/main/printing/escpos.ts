import { createReceipt, type ReceiptEncoding } from '@maxxuxx/node-printer'
import type {
  DrawerPin,
  PrintEncoding,
  PrintJob,
  PrintLine,
  ReportDocument,
} from '../../shared/printing'

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

/** Repeats one encoded block `copies` times without re-encoding it. */
function repeatBlock(block: Uint8Array, copies: number): Uint8Array {
  if (copies <= 1) return block
  const combined = new Uint8Array(block.length * copies)
  for (let copy = 0; copy < copies; copy += 1) {
    combined.set(block, copy * block.length)
  }
  return combined
}

/**
 * One receipt block: initialize → rows → feed → optional drawer kick → cut.
 *
 * The drawer command precedes the cut so the plain ESC/POS file still ends
 * with the cut sequence (the verification hook asserts that).
 *
 * A job carrying a `report` is a shift report, and `buildReportBytes` owns its
 * layout. Dispatching here — rather than in `printer.ts` — means the fake
 * adapter's `.escpos.bin` is byte-identical to what a real printer would
 * receive, with no second code path to keep in step.
 */
export function buildReceiptBytes(
  job: Pick<PrintJob, 'lines' | 'encoding' | 'openDrawer' | 'drawerPin'> & {
    report?: ReportDocument | undefined
  },
  copies = 1,
): Uint8Array {
  if (job.report) {
    return buildReportBytes(job.report, { encoding: job.encoding, copies })
  }

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

  return repeatBlock(receipt.encode(), copies)
}

// --- Shift reports (P13-D34) -------------------------------------------------

function center(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width)
  return `${' '.repeat(Math.floor((width - text.length) / 2))}${text}`
}

/** `left … right` padded to exactly `width` columns (at least one space). */
function leftRight(left: string, right: string, width = RECEIPT_COLUMNS): string {
  const safeRight = right.length > width ? right.slice(0, width) : right
  const gap = width - safeRight.length - 1
  const safeLeft = left.length > gap ? left.slice(0, Math.max(0, gap)) : left
  const padding = Math.max(1, width - safeLeft.length - safeRight.length)
  return `${safeLeft}${' '.repeat(padding)}${safeRight}`
}

/**
 * The four report roles as paper rows.
 *
 * The same function feeds the fake adapter's text file and `buildReportBytes`,
 * so a preview, a file, and a till roll cannot disagree. The padding lives here
 * (and not in the renderer) because a report's layout is the printer's width,
 * not the screen's.
 */
export function reportToPrintLines(report: ReportDocument): PrintLine[] {
  const rows: PrintLine[] = []

  for (const line of report.lines) {
    switch (line.kind) {
      case 'title':
        rows.push({ text: center(line.label ?? '', RECEIPT_COLUMNS), bold: true })
        break
      case 'rule':
        rows.push({ text: '-'.repeat(RECEIPT_COLUMNS) })
        break
      case 'total':
        rows.push({ text: leftRight(line.label ?? '', line.value ?? ''), bold: true })
        break
      default:
        rows.push({
          text: leftRight(line.label ?? '', line.value ?? ''),
          bold: Boolean(line.emphasis),
        })
    }
  }

  return rows
}

/**
 * A shift report: initialize → rows → feed → cut.
 *
 * No drawer kick: the drawer was counted by the time this prints, and opening
 * it again would be a cash-handling event nobody asked for.
 */
export function buildReportBytes(
  report: ReportDocument,
  options: { encoding: PrintEncoding; copies?: number },
): Uint8Array {
  const receipt = createReceipt({
    columns: RECEIPT_COLUMNS,
    encoding: options.encoding as ReceiptEncoding,
  }).initialize()

  for (const line of reportToPrintLines(report)) {
    appendLine(receipt, line)
  }

  receipt.feed(3)
  receipt.cut('full')

  return repeatBlock(receipt.encode(), options.copies ?? 1)
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
