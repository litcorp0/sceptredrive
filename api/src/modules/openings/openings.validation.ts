import { OPENING_MAX_ROWS } from '@sceptre/shared'
import { z } from 'zod'
import { validateJson, validateParam, validateQuery } from '../../http/validation.ts'
import { stockOpeningStatusEnum } from './openings.schema.ts'

const limitSchema = z.coerce.number().int().min(1).max(200).default(50)
const offsetSchema = z.coerce.number().int().min(0).default(0)

/**
 * One row exactly as the file has it. Money and quantity are strings on purpose:
 * the service parses them with the shared integer parser, so a value the console
 * mis-types cannot arrive as a rounded float.
 */
export const openingLineSchema = z
  .object({
    lineNo: z.number().int().min(1).optional(),
    sku: z.string().trim().max(32).optional(),
    barcode: z.string().trim().max(64).optional(),
    name: z.string().trim().min(1).max(120),
    category: z.string().trim().min(1).max(160),
    unit: z.string().trim().min(1).max(40),
    brand: z.string().trim().max(80).optional(),
    price: z.string().trim().max(40),
    cost: z.string().trim().max(40),
    quantity: z.string().trim().max(20),
    taxCategory: z.enum(['STANDARD', 'ZERO_RATED', 'EXEMPT']).optional(),
  })
  .strict()

export const openingPreviewSchema = z
  .object({
    branchId: z.uuid(),
    rows: z.array(openingLineSchema).min(1).max(OPENING_MAX_ROWS),
  })
  .strict()

export const openingCreateSchema = z
  .object({
    branchId: z.uuid(),
    countedAt: z.coerce.date().optional(),
    note: z.string().trim().max(300).optional(),
    idempotencyKey: z.string().trim().min(8).max(120).optional(),
    rows: z.array(openingLineSchema).min(1).max(OPENING_MAX_ROWS),
  })
  .strict()

export const openingPostSchema = z
  .object({
    acknowledgeUncosted: z.boolean().optional(),
  })
  .strict()

export const openingListQuerySchema = z.object({
  branchId: z.uuid().optional(),
  status: z.enum(stockOpeningStatusEnum.enumValues).optional(),
  limit: limitSchema,
  offset: offsetSchema,
})

export const openingIdParamSchema = z.object({ id: z.uuid() })

export const validateOpeningPreview = validateJson(openingPreviewSchema)
export const validateOpeningCreate = validateJson(openingCreateSchema)
export const validateOpeningPost = validateJson(openingPostSchema)
export const validateOpeningListQuery = validateQuery(openingListQuerySchema)
export const validateOpeningIdParam = validateParam(openingIdParamSchema)
