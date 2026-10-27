import { z } from 'zod'
import { validateJson, validateParam, validateQuery } from '../../http/validation.ts'
import { abcClassEnum, countFrequencyEnum, stockCountStatusEnum } from './counts.schema.ts'

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
  status: z.enum(stockCountStatusEnum.enumValues).optional(),
  /** The period, in Accra days, applied to `created_at` (P14-D19/D20). */
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: limitSchema,
  offset: offsetSchema,
})

export const countIdParamSchema = z.object({ id: z.uuid() })
export const abcProductParamSchema = z.object({ productId: z.uuid() })

// --- Schedules (P12-D28) -----------------------------------------------------

const scheduleCommon = {
  branchId: z.uuid().optional(),
  frequency: z.enum(countFrequencyEnum.enumValues),
  firstDueAt: z.iso.date().optional(),
  assignedTo: z.string().trim().min(1).max(100).optional(),
}

/**
 * One strict variant per scope, so a `CATEGORY` schedule cannot carry a brand
 * id and a `ROTATION` schedule cannot carry anything at all. The service still
 * derives the scope key; the transport shape only says which target was named.
 */
export const countScheduleCreateSchema = z.discriminatedUnion('scope', [
  z
    .object({
      scope: z.literal('CATEGORY'),
      categoryId: z.uuid(),
      ...scheduleCommon,
    })
    .strict(),
  z
    .object({
      scope: z.literal('BRAND'),
      brandId: z.uuid(),
      ...scheduleCommon,
    })
    .strict(),
  z
    .object({
      scope: z.literal('ABC_CLASS'),
      abcClass: z.enum(abcClassEnum.enumValues),
      ...scheduleCommon,
    })
    .strict(),
  z
    .object({
      scope: z.literal('ROTATION'),
      ...scheduleCommon,
    })
    .strict(),
])

export const countScheduleUpdateSchema = z
  .object({
    frequency: z.enum(countFrequencyEnum.enumValues).optional(),
    nextDueAt: z.iso.date().optional(),
    assignedTo: z.string().trim().min(1).max(100).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: 'At least one field must be supplied',
  })

export const countScheduleListQuerySchema = z.object({
  branchId: z.uuid().optional(),
  active: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  limit: limitSchema,
  offset: offsetSchema,
})

// --- ABC classes and accuracy (P12-D29, D33) ---------------------------------

export const abcListQuerySchema = z.object({
  branchId: z.uuid().optional(),
  abcClass: z.enum(abcClassEnum.enumValues).optional(),
})

export const abcManualSchema = z
  .object({
    branchId: z.uuid().optional(),
    abcClass: z.enum(abcClassEnum.enumValues),
    manual: z.boolean(),
  })
  .strict()

export const abcRecomputeSchema = z.object({ branchId: z.uuid().optional() }).strict()

export const countAccuracyQuerySchema = z
  .object({
    branchId: z.uuid().optional(),
    from: z.iso.date(),
    to: z.iso.date(),
  })
  .strict()

export const validateCountCreate = validateJson(countCreateSchema)
export const validateCountLinesUpdate = validateJson(countLinesUpdateSchema)
export const validateCountListQuery = validateQuery(countListQuerySchema)
export const validateCountIdParam = validateParam(countIdParamSchema)
export const validateAbcProductParam = validateParam(abcProductParamSchema)

export const validateCountScheduleCreate = validateJson(countScheduleCreateSchema)
export const validateCountScheduleUpdate = validateJson(countScheduleUpdateSchema)
export const validateCountScheduleListQuery = validateQuery(countScheduleListQuerySchema)
export const validateCountScheduleIdParam = validateParam(countIdParamSchema)

export const validateAbcListQuery = validateQuery(abcListQuerySchema)
export const validateAbcManual = validateJson(abcManualSchema)
export const validateAbcRecompute = validateJson(abcRecomputeSchema)
export const validateCountAccuracyQuery = validateQuery(countAccuracyQuerySchema)
