import { z } from 'zod'
import { validateJson, validateParam, validateQuery } from '../../http/validation.ts'

export const customerIdParamSchema = z.object({ id: z.uuid() })

const nameSchema = z.string().trim().min(1).max(120)
const phoneSchema = z.string().trim().min(6).max(20)

export const customerCreateSchema = z
  .object({
    name: nameSchema,
    phone: phoneSchema,
    email: z.email().max(160).optional(),
    address: z.string().trim().min(1).max(300).optional(),
    /** Required for admins (no home branch); managers default to their own branch. */
    branchId: z.uuid().optional(),
  })
  .strict()

export const customerUpdateSchema = z
  .object({
    name: nameSchema.optional(),
    phone: phoneSchema.optional(),
    email: z.email().max(160).nullish(),
    address: z.string().trim().max(300).nullish(),
  })
  .strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'At least one field must be provided',
  })

export const customerListQuerySchema = z.object({
  q: z.string().trim().min(2).max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  includeArchived: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
  branchId: z.uuid().optional(),
})

export const customerAnonymizeSchema = z
  .object({ note: z.string().trim().min(1).max(300).optional() })
  .strict()

export const validateCustomerIdParam = validateParam(customerIdParamSchema)
export const validateCustomerCreate = validateJson(customerCreateSchema)
export const validateCustomerUpdate = validateJson(customerUpdateSchema)
export const validateCustomerListQuery = validateQuery(customerListQuerySchema)
export const validateCustomerNote = validateJson(customerAnonymizeSchema)
