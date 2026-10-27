import { z } from 'zod'
import { validateJson, validateParam, validateQuery } from '../../http/validation.ts'

export const invoiceIdParamSchema = z.object({ id: z.uuid() })
export const paymentIdParamSchema = z.object({ id: z.uuid() })
export const transferIdParamSchema = z.object({ id: z.uuid() })

const limitSchema = z.coerce.number().int().min(1).max(100).default(50)
const offsetSchema = z.coerce.number().int().min(0).default(0)

const invoiceLineSchema = z
  .object({
    productId: z.uuid().optional(),
    description: z.string().trim().min(1).max(200).optional(),
    quantity: z.number().int().min(1).max(1_000_000),
    unitCostMinor: z.number().int().min(0).max(1_000_000_000),
    /** The ordered line this invoice line settles; optional, matched by product otherwise. */
    purchaseOrderLineId: z.uuid().optional(),
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
    /** The purchase order this invoice settles (Phase 11, PROC-04). */
    purchaseOrderId: z.uuid().optional(),
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
  receiptId: z.uuid().optional(),
  status: z.enum(['OPEN', 'PARTIAL', 'PAID', 'VOID']).optional(),
  overdue: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
  /** Only invoices with at least one purchase-order variance. */
  variance: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  limit: limitSchema,
  offset: offsetSchema,
})

const paymentAllocationSchema = z
  .object({
    invoiceId: z.uuid(),
    amountMinor: z.number().int().min(1).max(1_000_000_000),
  })
  .strict()

export const paymentCreateSchema = z
  .object({
    supplierId: z.uuid(),
    /** Required for admins; managers default to their own branch. */
    branchId: z.uuid().optional(),
    method: z.enum(['CASH', 'BANK', 'MOMO']),
    amountMinor: z.number().int().min(1).max(1_000_000_000),
    paidAt: z.iso.datetime({ offset: true }),
    reference: z.string().trim().min(1).max(80).optional(),
    note: z.string().trim().min(1).max(500).optional(),
    paymentDetailId: z.uuid().optional(),
    allocations: z.array(paymentAllocationSchema).max(20).optional(),
    idempotencyKey: z.string().trim().min(1).max(120).optional(),
  })
  .strict()
  .refine(
    (value) =>
      (value.allocations ?? []).reduce((sum, allocation) => sum + allocation.amountMinor, 0) <=
      value.amountMinor,
    { message: 'Allocations cannot exceed the payment amount' },
  )

export const paymentVoidSchema = z
  .object({
    reason: z.enum(['DUPLICATE', 'ERROR', 'RETURNED', 'BANK_REVERSAL', 'OTHER']),
  })
  .strict()

export const paymentListQuerySchema = z.object({
  supplierId: z.uuid().optional(),
  branchId: z.uuid().optional(),
  method: z.enum(['CASH', 'BANK', 'MOMO']).optional(),
  status: z.enum(['COMPLETED', 'VOID']).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  limit: limitSchema,
  offset: offsetSchema,
})

export const balancesQuerySchema = z.object({
  branchId: z.uuid().optional(),
})

export const agingQuerySchema = z.object({
  asOf: z.iso.date().optional(),
  branchId: z.uuid().optional(),
  supplierId: z.uuid().optional(),
})

/**
 * A supplier transfer (P14-D22). There is deliberately no `method`: it comes from
 * the saved payment detail, so a `CASH` payment can never be sent to Paystack.
 */
export const transferCreateSchema = z
  .object({
    supplierId: z.uuid(),
    /** Required for admins; managers default to their own branch. */
    branchId: z.uuid().optional(),
    paymentDetailId: z.uuid(),
    amountMinor: z.number().int().min(1).max(1_000_000_000),
    allocations: z.array(paymentAllocationSchema).max(20).optional(),
    note: z.string().trim().min(1).max(500).optional(),
    /** The client's key: a retried initiation returns the transfer it already made. */
    idempotencyKey: z.string().trim().min(1).max(120),
  })
  .strict()
  .refine(
    (value) =>
      (value.allocations ?? []).reduce((sum, allocation) => sum + allocation.amountMinor, 0) <=
      value.amountMinor,
    { message: 'Allocations cannot exceed the transfer amount' },
  )

export const transferFinalizeSchema = z
  .object({
    otp: z
      .string()
      .trim()
      .regex(/^\d{4,8}$/),
  })
  .strict()

export const transferListQuerySchema = z.object({
  supplierId: z.uuid().optional(),
  branchId: z.uuid().optional(),
  status: z
    .enum(['PENDING', 'AWAITING_OTP', 'SUCCESS', 'FAILED', 'REVERSED', 'BLOCKED', 'REJECTED'])
    .optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  limit: limitSchema,
  offset: offsetSchema,
})

export const transferReconciliationQuerySchema = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  branchId: z.uuid().optional(),
})

export const validateInvoiceIdParam = validateParam(invoiceIdParamSchema)
export const validatePaymentIdParam = validateParam(paymentIdParamSchema)
export const validateTransferIdParam = validateParam(transferIdParamSchema)
export const validateInvoiceCreate = validateJson(invoiceCreateSchema)
export const validateInvoiceVoid = validateJson(invoiceVoidSchema)
export const validateInvoiceListQuery = validateQuery(invoiceListQuerySchema)
export const validatePaymentCreate = validateJson(paymentCreateSchema)
export const validatePaymentVoid = validateJson(paymentVoidSchema)
export const validatePaymentListQuery = validateQuery(paymentListQuerySchema)
export const validateBalancesQuery = validateQuery(balancesQuerySchema)
export const validateAgingQuery = validateQuery(agingQuerySchema)
export const validateTransferCreate = validateJson(transferCreateSchema)
export const validateTransferFinalize = validateJson(transferFinalizeSchema)
export const validateTransferListQuery = validateQuery(transferListQuerySchema)
export const validateTransferReconciliationQuery = validateQuery(transferReconciliationQuerySchema)
