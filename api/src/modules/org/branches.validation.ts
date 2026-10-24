import { BRANCH_TYPES, isValidBranchCode } from '@sceptre/shared'
import { z } from 'zod'
import { validateJson, validateParam, validateQuery } from '../../http/validation.ts'

export const branchIdParamSchema = z.object({ id: z.uuid() })

export const branchCodeSchema = z
  .string()
  .trim()
  .min(2)
  .max(16)
  .refine(isValidBranchCode, { message: 'Invalid branch code format' })

export const branchCreateSchema = z
  .object({
    code: branchCodeSchema,
    name: z.string().trim().min(2).max(120),
    type: z.enum(BRANCH_TYPES),
    city: z.string().trim().min(1).max(80),
    area: z.string().trim().min(1).max(80).optional(),
    address: z.string().trim().min(1).max(240).optional(),
    phone: z.string().trim().min(3).max(32).optional(),
  })
  .strict()

export const branchUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    city: z.string().trim().min(1).max(80).optional(),
    area: z.string().trim().min(1).max(80).optional(),
    address: z.string().trim().min(1).max(240).optional(),
    phone: z.string().trim().min(3).max(32).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  })

export const branchListQuerySchema = z.object({
  includeInactive: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
})

export const suggestCodeQuerySchema = z.object({
  city: z.string().trim().min(1).max(80),
  area: z.string().trim().min(1).max(80).optional(),
  type: z.enum(BRANCH_TYPES),
})

export const validateBranchCreate = validateJson(branchCreateSchema)
export const validateBranchUpdate = validateJson(branchUpdateSchema)
export const validateBranchListQuery = validateQuery(branchListQuerySchema)
export const validateSuggestCodeQuery = validateQuery(suggestCodeQuerySchema)
export const validateBranchIdParam = validateParam(branchIdParamSchema)
