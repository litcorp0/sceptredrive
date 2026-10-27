/**
 * The printer contract shared by the renderer, preload, and main process.
 *
 * The renderer never touches a native module: it builds a plain, size-bounded
 * job (already wrapped to 42 columns) and hands it to the main process, which
 * owns the ESC/POS adapter. Print failures are **data**, not IPC errors: a
 * printer problem must never be classified as a crash or a lost sale (D28).
 */

export const PRINTER_DRIVERS = ['winspool', 'network', 'fake'] as const
export type PrinterDriver = (typeof PRINTER_DRIVERS)[number]

export const PRINT_ENCODINGS = ['windows-1252', 'cp437', 'cp850', 'ascii', 'utf8'] as const
export type PrintEncoding = (typeof PRINT_ENCODINGS)[number]

export type DrawerPin = 2 | 5

/** Where to send bytes. `fake` writes files and is the dev/CI default. */
export interface PrinterTarget {
  driver: PrinterDriver
  /** Windows spooler queue name (`winspool`). */
  printerName?: string | undefined
  /** TCP host (`network`), e.g. `192.168.1.50`. */
  host?: string | undefined
  /** TCP port (`network`), normally 9100. */
  port?: number | undefined
}

/** One already-padded receipt row. Widths are the renderer's job (42 columns). */
export interface PrintLine {
  text: string
  /** Emit bold on/off around this row (the total, and the reprint marker). */
  bold?: boolean
}

/**
 * A report row, described by its job rather than by its text (P13-D34).
 *
 * A shift report is the same paper as a receipt but not the same shape: it has
 * sections, figures that line up on the right, and rules between blocks. Naming
 * those four roles keeps the main process out of the business vocabulary — it
 * never learns what "loyalty redeemed" means, only that a row is a row.
 */
export const REPORT_LINE_KINDS = ['title', 'row', 'rule', 'total'] as const
export type ReportLineKind = (typeof REPORT_LINE_KINDS)[number]

export interface ReportLine {
  kind: ReportLineKind
  /** Left text for `row`/`total`, the centred text for `title`. */
  label?: string | undefined
  /** Right text for `row`/`total`; ignored by `title` and `rule`. */
  value?: string | undefined
  emphasis?: boolean | undefined
}

/** The whole document the renderer hands the printer. Widths are 42 columns. */
export interface ReportDocument {
  /** `Z-REPORT` or `X-REPORT`, printed centred above the figures. */
  title: string
  /** Shift number; also the fake adapter's file name. */
  reference: string
  lines: ReportLine[]
}

export interface PrintJob {
  /** Validated receipt number; also the fake adapter's file name. */
  receiptNumber: string
  /** Empty for a report: the main process owns that layout (`report` below). */
  lines: PrintLine[]
  encoding: PrintEncoding
  /** 1–3. Each copy is a separate receipt block. */
  copies: number
  /** Append the drawer kick to the receipt. */
  openDrawer: boolean
  drawerPin: DrawerPin
  /**
   * A shift report. Present means the main process lays the rows out itself
   * (one 42-column implementation in `escpos.ts`), so the renderer cannot print
   * a report that looks different from the one it previews. The same channel
   * carries it: the preload bridge stays the fixed, typed surface it already is.
   */
  report?: ReportDocument | undefined
}

export interface PrintRequest {
  target: PrinterTarget
  job: PrintJob
}

export interface DrawerRequest {
  target: PrinterTarget
  drawerPin: DrawerPin
}

export type PrintFailureCode =
  | 'PRINTER_NOT_CONFIGURED'
  | 'PRINTER_UNSUPPORTED'
  | 'PRINTER_UNAVAILABLE'
  | 'PRINTER_FAILED'
  | 'DRAWER_FAILED'

/** A business outcome. `ok: false` never rolls a sale back. */
export type PrintOutcome =
  | { ok: true; bytes: number }
  | { ok: false; code: PrintFailureCode; message: string }

export interface PrinterInfo {
  name: string
  driver: 'winspool' | 'cups' | 'fake'
  isDefault: boolean
}

/** Hard bounds enforced again in the main process (defence in depth). */
export const PRINT_LIMITS = {
  maxLines: 400,
  maxLineLength: 200,
  maxCopies: 3,
  defaultPort: 9100,
} as const
