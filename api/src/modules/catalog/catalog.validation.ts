import { z } from 'zod'
import { validateJson, validateParam, validateQuery } from '../../http/validation.ts'

export const catalogIdParamSchema = z.object({ id: z.uuid() })

export const catalogListQuerySchema = z.object({
  includeArchived: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
})

const nameSchema = z.string().trim().min(2).max(80)

export const categoryCreateSchema = z
  .object({
    name: nameSchema,
    parentId: z.uuid().nullish(),
  })
  .strict()

export const categoryUpdateSchema = z
  .object({
    name: nameSchema.optional(),
    parentId: z.uuid().nullish(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  })

export const brandCreateSchema = z.object({ name: nameSchema }).strict()

export const brandUpdateSchema = z.object({ name: nameSchema }).strict()

export const uomCodeSchema = z
  .string()
  .trim()
  .min(2)
  .max(8)
  .regex(/^[A-Za-z0-9]+$/, 'Use letters and digits only')
  .transform((value) => value.toUpperCase())

export const uomCreateSchema = z
  .object({
    code: uomCodeSchema,
    name: nameSchema,
  })
  .strict()

export const uomUpdateSchema = z.object({ name: nameSchema }).strict()

export const validateCatalogIdParam = validateParam(catalogIdParamSchema)
export const validateCatalogListQuery = validateQuery(catalogListQuerySchema)
export const validateCategoryCreate = validateJson(categoryCreateSchema)
export const validateCategoryUpdate = validateJson(categoryUpdateSchema)
export const validateBrandCreate = validateJson(brandCreateSchema)
export const validateBrandUpdate = validateJson(brandUpdateSchema)
export const validateUomCreate = validateJson(uomCreateSchema)
export const validateUomUpdate = validateJson(uomUpdateSchema)
