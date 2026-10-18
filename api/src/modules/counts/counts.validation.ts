import { z } from 'zod'
import { validateJson, validateParam, validateQuery } from '../../http/validation.ts'

const limitSchema = z.coerce.number().int().min(1).max(200).default(50)
const offsetSchema = z.coerce.number().int().min(0).default(0)

export const countCreateSchema = z
  .object({
    branchId: z.uuid(),
    categoryId: z.uuid().optional(),
    note: z.string().trim().min(1).max(300).optional(),
  })
  .strict()

const countLineSchema = z
  .object({
    productId: z.uuid(),
    countedQty: z.number().int().min(0).max(1_000_000).nullable(),
  })
  .strict()

export const countLinesUpdateSchema = z
  .object({ lines: z.array(countLineSchema).min(1).max(500) })
  .strict()
  .refine(
    (value) => new Set(value.lines.map((line) => line.productId)).size === value.lines.length,
    { message: 'Each product may appear only once' },
  )

export const countListQuerySchema = z.object({
  branchId: z.uuid().optional(),
  status: z.enum(['OPEN', 'POSTED', 'CANCELLED']).optional(),
  limit: limitSchema,
  offset: offsetSchema,
})

export const countIdParamSchema = z.object({ id: z.uuid() })

export const validateCountCreate = validateJson(countCreateSchema)
export const validateCountLinesUpdate = validateJson(countLinesUpdateSchema)
export const validateCountListQuery = validateQuery(countListQuerySchema)
export const validateCountIdParam = validateParam(countIdParamSchema)
