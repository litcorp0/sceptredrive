import { z } from 'zod'
import { validateJson, validateParam, validateQuery } from '../../http/validation.ts'

export const productIdParamSchema = z.object({ id: z.uuid() })

export const productBarcodeParamSchema = z.object({ id: z.uuid(), barcodeId: z.uuid() })

export const productBranchParamSchema = z.object({ id: z.uuid(), branchId: z.uuid() })

const skuSchema = z
  .string()
  .trim()
  .min(2)
  .max(32)
  .regex(/^[A-Za-z0-9-]+$/, 'Use letters, digits, and dashes only')
  .transform((value) => value.toUpperCase())

export const barcodeCodeSchema = z
  .string()
  .trim()
  .min(6)
  .max(64)
  .regex(/^[A-Za-z0-9-]+$/, 'Use letters, digits, and dashes only')

const priceMinorSchema = z.number().int().min(0)

export const taxCategorySchema = z.enum(['STANDARD', 'ZERO_RATED', 'EXEMPT'])

export const productCreateSchema = z
  .object({
    sku: skuSchema.optional(),
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().min(1).max(500).optional(),
    categoryId: z.uuid(),
    brandId: z.uuid().nullish(),
    uomId: z.uuid(),
    costPriceMinor: priceMinorSchema.optional(),
    basePriceMinor: priceMinorSchema,
    taxCategory: taxCategorySchema.optional(),
    barcodes: z.array(barcodeCodeSchema).max(10).optional(),
  })
  .strict()

export const productUpdateSchema = z
  .object({
    sku: skuSchema.optional(),
    name: z.string().trim().min(2).max(120).optional(),
    description: z.string().trim().min(1).max(500).optional(),
    categoryId: z.uuid().optional(),
    brandId: z.uuid().nullish(),
    uomId: z.uuid().optional(),
    costPriceMinor: priceMinorSchema.optional(),
    basePriceMinor: priceMinorSchema.optional(),
    taxCategory: taxCategorySchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  })

export const productListQuerySchema = z.object({
  q: z.string().trim().min(1).max(120).optional(),
  categoryId: z.uuid().optional(),
  brandId: z.uuid().optional(),
  includeArchived: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
  branchId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

export const barcodeCreateSchema = z.object({ code: barcodeCodeSchema }).strict()

export const priceOverrideSchema = z
  .object({
    branchId: z.uuid(),
    priceMinor: priceMinorSchema,
  })
  .strict()

export const validateProductIdParam = validateParam(productIdParamSchema)
export const validateProductBarcodeParam = validateParam(productBarcodeParamSchema)
export const validateProductBranchParam = validateParam(productBranchParamSchema)
export const validateProductCreate = validateJson(productCreateSchema)
export const validateProductUpdate = validateJson(productUpdateSchema)
export const validateProductListQuery = validateQuery(productListQuerySchema)
export const validateBarcodeCreate = validateJson(barcodeCreateSchema)
export const validatePriceOverride = validateJson(priceOverrideSchema)
