import { z } from 'zod'
import { validateJson, validateParam, validateQuery } from '../../http/validation.ts'
import { stockWriteOffStatusEnum } from './writeoffs.schema.ts'
import { STOCK_WRITE_OFF_REASONS } from './writeoffs.types.ts'

const limitSchema = z.coerce.number().int().min(1).max(200).default(50)
const offsetSchema = z.coerce.number().int().min(0).default(0)

const writeOffLineSchema = z
  .object({
    productId: z.uuid(),
    quantity: z.number().int().min(1).max(1_000_000),
    reason: z.enum(STOCK_WRITE_OFF_REASONS),
    // Required for THEFT and OTHER; the service enforces it so the refusal can
    // name the product (P12-D16).
    note: z.string().trim().max(300).optional(),
  })
  .strict()

export const writeOffCreateSchema = z
  .object({
    lines: z.array(writeOffLineSchema).min(1).max(100),
    note: z.string().trim().max(300).optional(),
  })
  .strict()
  .refine(
    (value) => new Set(value.lines.map((line) => line.productId)).size === value.lines.length,
    { message: 'Each product may appear only once' },
  )

export const writeOffListQuerySchema = z.object({
  branchId: z.uuid().optional(),
  status: z.enum(stockWriteOffStatusEnum.enumValues).optional(),
  limit: limitSchema,
  offset: offsetSchema,
})

export const writeOffIdParamSchema = z.object({ id: z.uuid() })

export const validateWriteOffCreate = validateJson(writeOffCreateSchema)
export const validateWriteOffListQuery = validateQuery(writeOffListQuerySchema)
export const validateWriteOffIdParam = validateParam(writeOffIdParamSchema)
