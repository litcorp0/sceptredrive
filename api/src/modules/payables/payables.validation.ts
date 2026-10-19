import { z } from 'zod'
import { validateJson, validateParam, validateQuery } from '../../http/validation.ts'

export const invoiceIdParamSchema = z.object({ id: z.uuid() })

const limitSchema = z.coerce.number().int().min(1).max(100).default(50)
const offsetSchema = z.coerce.number().int().min(0).default(0)

const invoiceLineSchema = z
  .object({
    productId: z.uuid().optional(),
    description: z.string().trim().min(1).max(200).optional(),
    quantity: z.number().int().min(1).max(1_000_000),
    unitCostMinor: z.number().int().min(0).max(1_000_000_000),
  })
  .strict()
  .refine((line) => (line.productId === undefined) !== (line.description === undefined), {
    message: 'Each line needs exactly one of productId or description',
  })

export const invoiceCreateSchema = z
  .object({
    supplierId: z.uuid(),
    /** Required for admins; managers default to their own branch. */
    branchId: z.uuid().optional(),
    supplierInvoiceNumber: z.string().trim().min(1).max(60),
    invoiceDate: z.iso.date(),
    dueDate: z.iso.date().optional(),
    receiptId: z.uuid().optional(),
    copyFromReceipt: z.boolean().optional(),
    lines: z.array(invoiceLineSchema).min(1).max(100).optional(),
    vatMinor: z.number().int().min(0).max(1_000_000_000).optional(),
    nhilMinor: z.number().int().min(0).max(1_000_000_000).optional(),
    getfundMinor: z.number().int().min(0).max(1_000_000_000).optional(),
    note: z.string().trim().min(1).max(500).optional(),
    idempotencyKey: z.string().trim().min(1).max(120).optional(),
  })
  .strict()
  .refine((value) => value.lines !== undefined || value.copyFromReceipt === true, {
    message: 'Provide invoice lines or set copyFromReceipt',
  })
  .refine((value) => value.copyFromReceipt !== true || value.receiptId !== undefined, {
    message: 'copyFromReceipt requires a receiptId',
  })

export const invoiceVoidSchema = z
  .object({
    reason: z.enum(['DUPLICATE', 'CANCELLED', 'ERROR', 'OTHER']),
  })
  .strict()

export const invoiceListQuerySchema = z.object({
  supplierId: z.uuid().optional(),
  branchId: z.uuid().optional(),
  status: z.enum(['OPEN', 'PARTIAL', 'PAID', 'VOID']).optional(),
  overdue: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  limit: limitSchema,
  offset: offsetSchema,
})

export const validateInvoiceIdParam = validateParam(invoiceIdParamSchema)
export const validateInvoiceCreate = validateJson(invoiceCreateSchema)
export const validateInvoiceVoid = validateJson(invoiceVoidSchema)
export const validateInvoiceListQuery = validateQuery(invoiceListQuerySchema)
