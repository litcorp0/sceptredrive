import { z } from 'zod'
import { IPC_CHANNELS } from '../../shared/ipc'
import {
  PRINT_ENCODINGS,
  PRINT_LIMITS,
  PRINTER_DRIVERS,
  type PrinterTarget,
  type PrintJob,
} from '../../shared/printing'
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

const printRequestSchema = z.object({ target: targetSchema, job: printJobSchema }).strict()
const drawerRequestSchema = z
  .object({ target: targetSchema, drawerPin: z.union([z.literal(2), z.literal(5)]) })
  .strict()
const testRequestSchema = z
  .object({ target: targetSchema, encoding: z.enum(PRINT_ENCODINGS) })
  .strict()

export function registerPrinterHandlers(handle: IpcHandle, runtime: PrinterRuntime): void {
  handle(IPC_CHANNELS.printerList, () => listPrinters(runtime))

  handle(IPC_CHANNELS.printerPrint, async (rawRequest: unknown) => {
    const request = printRequestSchema.parse(rawRequest)
    return printJob(runtime, {
      target: request.target as PrinterTarget,
      job: request.job as PrintJob,
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
