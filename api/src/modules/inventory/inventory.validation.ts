import { z } from 'zod'
import { validateJson, validateParam, validateQuery } from '../../http/validation.ts'
import { stockMovementTypeEnum } from './inventory.schema.ts'

const limitSchema = z.coerce.number().int().min(1).max(200).default(50)
const offsetSchema = z.coerce.number().int().min(0).default(0)

const receiptLineSchema = z
  .object({
    productId: z.uuid(),
    quantity: z.number().int().min(1).max(1_000_000),
    unitCostMinor: z.number().int().min(0).max(100_000_000_000),
  })
  .strict()

export const receiptCreateSchema = z
  .object({
    branchId: z.uuid(),
    supplierId: z.uuid().optional(),
    supplierName: z.string().trim().min(1).max(120).optional(),
    supplierInvoiceNumber: z.string().trim().min(1).max(60).optional(),
    note: z.string().trim().min(1).max(300).optional(),
    lines: z.array(receiptLineSchema).min(1).max(100),
  })
  .strict()
  .refine(
    (value) => new Set(value.lines.map((line) => line.productId)).size === value.lines.length,
    {
      message: 'Each product may appear only once in a receipt',
    },
  )

export const receiptListQuerySchema = z.object({
  branchId: z.uuid().optional(),
  purchaseOrderId: z.uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: limitSchema,
  offset: offsetSchema,
})

export const receiptIdParamSchema = z.object({ id: z.uuid() })

export const adjustmentCreateSchema = z
  .object({
    branchId: z.uuid(),
    productId: z.uuid(),
    quantityDelta: z
      .number()
      .int()
      .refine((value) => value !== 0, { message: 'Quantity must not be zero' }),
    reasonCode: z.enum(['DAMAGE', 'LOSS', 'FOUND', 'CORRECTION', 'EXPIRED', 'OTHER']),
    note: z.string().trim().min(1).max(300).optional(),
    /**
     * Opening stock carries what it cost (17-05). Only a positive FOUND or
     * CORRECTION may send it; the service refuses the rest rather than silently
     * revaluing a level.
     */
    unitCostMinor: z.number().int().min(0).max(100_000_000_000).optional(),
  })
  .strict()

/**
 * The movement filter accepts **every** value the pg enum stores (P14-D18).
 *
 * It used to be a hand-copied list of five, so the largest outflow in a retail ledger —
 * `SALE` — could not be filtered, and neither could `WRITE_OFF`, `SUPPLIER_RETURN` or
 * `RETURN`. Deriving from the enum means a future movement type is filterable the day it
 * is added instead of the day someone notices it missing.
 */
export const movementListQuerySchema = z.object({
  branchId: z.uuid().optional(),
  productId: z.uuid().optional(),
  type: z.enum(stockMovementTypeEnum.enumValues).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: limitSchema,
  offset: offsetSchema,
})

export const stockListQuerySchema = z.object({
  branchId: z.uuid().optional(),
  q: z.string().trim().min(1).max(120).optional(),
  lowStock: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
  outOfStock: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
  /**
   * Only products this branch actually carries — a stock level here, even at zero
   * (P20-D17). A product the branch never stocked is a catalogue row, not a stock
   * row, and the list is noisy enough without it.
   */
  carried: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
  limit: limitSchema,
  offset: offsetSchema,
})

export const stockProductParamSchema = z.object({ productId: z.uuid() })

/**
 * The stock report's period. `from`/`to` are ISO **days** and inclusive: the report
 * counts `[from 00:00, to+1 00:00)` Accra time, which for UTC+0 is the UTC day. A day is
 * the granularity an accountant reconciles at, so a timestamp is refused rather than
 * silently narrowed to the day it happens to fall in.
 */
export const stockReportQuerySchema = z
  .object({
    branchId: z.uuid().optional(),
    categoryId: z.uuid().optional(),
    lowStock: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => value === 'true'),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
  })
  .strict()

export const stockDetailQuerySchema = z.object({ branchId: z.uuid().optional() })

export const thresholdUpdateSchema = z
  .object({
    branchId: z.uuid(),
    productId: z.uuid(),
    threshold: z.number().int().min(0).max(1_000_000),
    /** Omitted means "keep what is stored", or `2 × threshold` on a new row. */
    maxQuantity: z.number().int().min(0).max(1_000_000).nullish(),
    minOrderQuantity: z.number().int().min(0).max(1_000_000).optional(),
  })
  .strict()

export const thresholdDeleteQuerySchema = z.object({ branchId: z.uuid().optional() })

export const validateReceiptCreate = validateJson(receiptCreateSchema)
export const validateReceiptListQuery = validateQuery(receiptListQuerySchema)
export const validateReceiptIdParam = validateParam(receiptIdParamSchema)
export const validateAdjustmentCreate = validateJson(adjustmentCreateSchema)
export const validateMovementListQuery = validateQuery(movementListQuerySchema)
export const validateStockListQuery = validateQuery(stockListQuerySchema)
export const validateStockReportQuery = validateQuery(stockReportQuerySchema)
export const validateStockProductParam = validateParam(stockProductParamSchema)
export const validateStockDetailQuery = validateQuery(stockDetailQuerySchema)
export const validateThresholdUpdate = validateJson(thresholdUpdateSchema)
export const validateThresholdDeleteQuery = validateQuery(thresholdDeleteQuerySchema)
