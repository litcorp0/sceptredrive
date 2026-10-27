import { z } from 'zod'
import { IPC_CHANNELS } from '../../shared/ipc'
import {
  PRINT_ENCODINGS,
  PRINT_LIMITS,
  PRINTER_DRIVERS,
  type PrinterTarget,
  type PrintJob,
} from '../../shared/printing'
import { reportToPrintLines } from '../printing/escpos'
import {
  listPrinters,
  openDrawer,
  type PrinterRuntime,
  printJob,
  testJob,
} from '../printing/printer'

/**
 * Printer IPC handlers (D28).
 *
 * Every input is validated here, in the main process, even though the renderer
 * also validates: the renderer is not trusted. The job is bounded (line count,
 * line length, copies) and the target is an allowlist, so a compromised frame
 * cannot turn printing into an arbitrary file write or a port scanner.
 */

type IpcHandle = <Args extends unknown[], T>(
  channel: string,
  handler: (...args: Args) => Promise<T>,
) => void

const hostSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9._:-]+$/, 'Invalid printer host')

const targetSchema = z
  .object({
    driver: z.enum(PRINTER_DRIVERS),
    printerName: z.string().trim().max(128).optional(),
    host: hostSchema.optional(),
    port: z.number().int().min(1).max(65_535).optional(),
  })
  .strict()
  .superRefine((target, ctx) => {
    if (target.driver === 'winspool' && !target.printerName) {
      ctx.addIssue({ code: 'custom', message: 'A Windows printer name is required' })
    }
    if (target.driver === 'network' && !target.host) {
      ctx.addIssue({ code: 'custom', message: 'A network host is required' })
    }
  })

const lineSchema = z
  .object({
    text: z.string().max(PRINT_LIMITS.maxLineLength),
    bold: z.boolean().optional(),
  })
  .strict()

export const printJobSchema = z
  .object({
    receiptNumber: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9-]+$/, 'Invalid receipt number'),
    lines: z.array(lineSchema).min(1).max(PRINT_LIMITS.maxLines),
    encoding: z.enum(PRINT_ENCODINGS),
    copies: z.number().int().min(1).max(PRINT_LIMITS.maxCopies),
    openDrawer: z.boolean(),
    drawerPin: z.union([z.literal(2), z.literal(5)]),
  })
  .strict()

/**
 * A shift report (P13-D34), validated field by field in the main process.
 *
 * The renderer is not trusted: the row count is bounded, every string is
 * length-capped, and `openDrawer` is pinned to `false` so a report can never
 * kick the drawer. The document carries styling roles only — the main process
 * has no idea what the figures mean, which is the point.
 */
const reportLineSchema = z
  .object({
    kind: z.enum(['title', 'row', 'rule', 'total']),
    label: z.string().max(PRINT_LIMITS.maxLineLength).optional(),
    value: z.string().max(PRINT_LIMITS.maxLineLength).optional(),
    emphasis: z.boolean().optional(),
  })
  .strict()

const reportDocumentSchema = z
  .object({
    title: z.string().min(1).max(64),
    reference: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9-]+$/, 'Invalid report number'),
    lines: z.array(reportLineSchema).min(1).max(PRINT_LIMITS.maxLines),
  })
  .strict()

const reportJobSchema = z
  .object({
    receiptNumber: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9-]+$/, 'Invalid report number'),
    // A report's layout is the main process's; the renderer sends none.
    lines: z.array(lineSchema).max(0),
    encoding: z.enum(PRINT_ENCODINGS),
    copies: z.number().int().min(1).max(PRINT_LIMITS.maxCopies),
    openDrawer: z.literal(false),
    drawerPin: z.union([z.literal(2), z.literal(5)]),
    report: reportDocumentSchema,
  })
  .strict()

/** Either a receipt or a report; the shapes are disjoint on `report`. */
export const printerJobSchema = z.union([reportJobSchema, printJobSchema])

const printRequestSchema = z.object({ target: targetSchema, job: printerJobSchema }).strict()
const drawerRequestSchema = z
  .object({ target: targetSchema, drawerPin: z.union([z.literal(2), z.literal(5)]) })
  .strict()
const testRequestSchema = z
  .object({ target: targetSchema, encoding: z.enum(PRINT_ENCODINGS) })
  .strict()

/**
 * A report goes through the same printer capability as a receipt, with the rows
 * the real adapter would print filled in for the fake one. Splitting the channel
 * would mean a second preload method for one document; the schema above is what
 * keeps the two jobs apart.
 */
export async function printReport(
  runtime: PrinterRuntime,
  target: PrinterTarget,
  job: PrintJob,
): Promise<ReturnType<typeof printJob>> {
  const report = job.report
  if (!report) {
    // The schema above refuses a report job without a document, so this is the
    // internal invariant rather than a user-facing outcome.
    throw new Error('A report print needs a report document')
  }
  return printJob(runtime, {
    target,
    job: { ...job, lines: reportToPrintLines(report) },
  })
}

export function registerPrinterHandlers(handle: IpcHandle, runtime: PrinterRuntime): void {
  handle(IPC_CHANNELS.printerList, () => listPrinters(runtime))

  handle(IPC_CHANNELS.printerPrint, async (rawRequest: unknown) => {
    const request = printRequestSchema.parse(rawRequest)
    const job = request.job as PrintJob
    if (job.report) return printReport(runtime, request.target as PrinterTarget, job)
    return printJob(runtime, {
      target: request.target as PrinterTarget,
      job,
    })
  })

  handle(IPC_CHANNELS.printerOpenDrawer, async (rawRequest: unknown) => {
    const request = drawerRequestSchema.parse(rawRequest)
    return openDrawer(runtime, {
      target: request.target as PrinterTarget,
      drawerPin: request.drawerPin,
    })
  })

  handle(IPC_CHANNELS.printerTest, async (rawRequest: unknown) => {
    const request = testRequestSchema.parse(rawRequest)
    return printJob(runtime, {
      target: request.target as PrinterTarget,
      job: testJob(request.encoding),
    })
  })
}
