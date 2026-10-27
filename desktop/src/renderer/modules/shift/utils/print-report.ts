import type { PowerSyncDatabase } from '@powersync/web'
import { formatAccraDateTime } from '@sceptre/shared'
import type { PosIdentityRow } from '@/lib/pos-runtime'
import { desktopPrinterTransport, type PrinterTransport } from '@/lib/printing/printer-service'
import { loadPrinterSettings, type PrinterSettings, toPrinterTarget } from '@/lib/printing/settings'
import { buildReportDocument, type ReportDocumentContext } from '@/lib/receipt/report-render'
import type { LocalShiftReport } from '@/lib/shift/shift-report'
import type { PrintJob, PrintOutcome, ReportDocument } from '../../../../shared/printing'
import { varianceWords } from './variance'

/**
 * Printing a report (P13-D34).
 *
 * The document is built from the **local** snapshot, so a Z prints with the
 * cable out. A print failure is data, not a failed close: the shift is already
 * closed on disk and the screen offers **Print again**.
 *
 * The job reuses the receipt print capability with a `report` document; the
 * main process pads the columns and builds the bytes, so there is one layout.
 */

/** The fake adapter writes a file named after this, so it must be printable. */
export function reportFileReference(reference: string): string {
  return reference.replace(/[^A-Za-z0-9-]/g, '-').slice(0, 64) || 'SHIFT-REPORT'
}

export function reportPrintJob(document: ReportDocument, settings: PrinterSettings): PrintJob {
  return {
    receiptNumber: reportFileReference(document.reference),
    // A report's rows are laid out by the main process; the fake adapter fills
    // them from the document in `ipc/printer.ts` before it writes its text file.
    lines: [],
    encoding: settings.encoding,
    copies: settings.copies,
    openDrawer: false,
    drawerPin: settings.drawerPin,
    report: document,
  }
}

export interface PrintReportDeps {
  transport?: PrinterTransport
  settings?: PrinterSettings
}

export async function printReportDocument(
  db: PowerSyncDatabase,
  document: ReportDocument,
  deps: PrintReportDeps = {},
): Promise<PrintOutcome> {
  const settings = deps.settings ?? (await loadPrinterSettings(db))
  return (deps.transport ?? desktopPrinterTransport).print(
    toPrinterTarget(settings),
    reportPrintJob(document, settings),
  )
}

/**
 * The X and Z share one document builder; `kind` is the only difference a
 * reader sees on paper ("not stored, not a close" versus "stored at close").
 */
export function shiftReportContext(input: {
  kind: 'X' | 'Z'
  report: LocalShiftReport
  identity: Pick<PosIdentityRow, 'branchCode' | 'branchName' | 'terminalCode'>
  cashierName: string
  seller?: string | undefined
  currencySymbol?: string | undefined
  reprint?: boolean | undefined
}): ReportDocumentContext {
  return {
    kind: input.kind,
    seller: input.seller?.trim() || 'Sceptre Drive',
    branchName: input.identity.branchName,
    branchCode: input.identity.branchCode,
    terminalCode: input.identity.terminalCode,
    shiftNumber: input.report.number,
    openedAt: input.report.openedAt,
    closedAt: input.report.closedAt,
    cashierName: input.cashierName,
    generatedAt: input.report.generatedAt,
    varianceLabel: varianceWords(input.report.varianceMinor ?? 0),
    currencySymbol: input.currencySymbol,
    reprint: input.reprint,
  }
}

/** The Z document for a just-closed shift, ready to print or reprint. */
export function closedShiftDocument(input: {
  kind?: 'X' | 'Z' | undefined
  report: LocalShiftReport
  identity: Pick<PosIdentityRow, 'branchCode' | 'branchName' | 'terminalCode'>
  cashierName: string
  seller?: string | undefined
  currencySymbol?: string | undefined
  reprint?: boolean | undefined
}): ReportDocument {
  return buildReportDocument(
    input.report,
    shiftReportContext({
      kind: input.kind ?? 'Z',
      report: input.report,
      identity: input.identity,
      cashierName: input.cashierName,
      seller: input.seller,
      currencySymbol: input.currencySymbol,
      reprint: input.reprint,
    }),
  )
}

/**
 * A second copy is a reprint, and the paper says so (P13-D34). Idempotent, so a
 * double press does not stack bands.
 */
export function reportReprintDocument(document: ReportDocument): ReportDocument {
  if (document.lines.some((line) => line.label === '*** REPRINT ***')) return document
  return {
    ...document,
    lines: [{ kind: 'title', label: '*** REPRINT ***' }, { kind: 'rule' }, ...document.lines],
  }
}

/** One line under the summary card: a printed report is a fact, a failure a retry. */
export function reportPrintLabel(outcome: PrintOutcome): string {
  if (outcome.ok) return 'Report printed'
  switch (outcome.code) {
    case 'PRINTER_NOT_CONFIGURED':
      return 'No printer is set up on this till — the report is saved and can be printed again.'
    case 'PRINTER_UNAVAILABLE':
      return 'The printer is not reachable — the report is saved and can be printed again.'
    default:
      return 'The report did not print — the shift is closed, and you can print it again.'
  }
}

/** Timestamp for the report footer preview; Accra time, never the machine's zone. */
export function reportGeneratedLabel(report: LocalShiftReport): string {
  return formatAccraDateTime(report.generatedAt)
}
