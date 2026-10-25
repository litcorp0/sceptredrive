import { PURCHASE_ORDER_STATUSES } from '@sceptre/shared'
import { z } from 'zod'
import { validateJson, validateParam, validateQuery } from '../../http/validation.ts'

const limitSchema = z.coerce.number().int().min(1).max(200).default(50)
const offsetSchema = z.coerce.number().int().min(0).default(0)

const orderLineSchema = z
  .object({
    productId: z.uuid(),
    quantity: z.number().int().min(1).max(1_000_000),
    unitCostMinor: z.number().int().min(0).max(100_000_000_000),
  })
  .strict()

function noDuplicateProducts(lines: { productId: string }[]): boolean {
  return new Set(lines.map((line) => line.productId)).size === lines.length
}

export const orderCreateSchema = z
  .object({
    branchId: z.uuid(),
    supplierId: z.uuid(),
    expectedDate: z.iso.date().optional(),
    note: z.string().trim().min(1).max(300).optional(),
    idempotencyKey: z.uuid(),
    lines: z.array(orderLineSchema).min(1).max(100),
  })
  .strict()
  .refine((value) => noDuplicateProducts(value.lines), {
    message: 'Each product may appear only once in an order',
  })

export const orderUpdateSchema = z
  .object({
    supplierId: z.uuid().optional(),
    expectedDate: z.iso.date().nullish(),
    note: z.string().trim().min(1).max(300).nullish(),
    lines: z
      .array(orderLineSchema)
      .min(1)
      .max(100)
      .refine(noDuplicateProducts, { message: 'Each product may appear only once in an order' })
      .optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'At least one field is required' })

export const orderListQuerySchema = z.object({
  branchId: z.uuid().optional(),
  supplierId: z.uuid().optional(),
  status: z.enum(PURCHASE_ORDER_STATUSES).optional(),
  q: z.string().trim().min(2).max(120).optional(),
  limit: limitSchema,
  offset: offsetSchema,
})

export const orderIdParamSchema = z.object({ id: z.uuid() })

export const orderCancelSchema = z.object({ reason: z.string().trim().min(3).max(300) }).strict()

export const orderCloseSchema = z
  .object({ note: z.string().trim().min(1).max(300).optional() })
  .strict()

export const validateOrderCreate = validateJson(orderCreateSchema)
export const validateOrderUpdate = validateJson(orderUpdateSchema)
export const validateOrderListQuery = validateQuery(orderListQuerySchema)
export const validateOrderIdParam = validateParam(orderIdParamSchema)
export const validateOrderCancel = validateJson(orderCancelSchema)
export const validateOrderClose = validateJson(orderCloseSchema)
