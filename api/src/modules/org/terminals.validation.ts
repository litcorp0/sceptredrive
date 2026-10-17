import { z } from 'zod'
import { validateJson, validateParam, validateQuery } from '../../http/validation.ts'

export const terminalIdParamSchema = z.object({ id: z.uuid() })

export const terminalCreateSchema = z
  .object({
    branchId: z.uuid(),
    name: z.string().trim().min(2).max(80),
  })
  .strict()

export const terminalUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'At least one field is required' })

export const terminalListQuerySchema = z.object({
  branchId: z.uuid().optional(),
  includeInactive: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
})

export const validateTerminalCreate = validateJson(terminalCreateSchema)
export const validateTerminalUpdate = validateJson(terminalUpdateSchema)
export const validateTerminalListQuery = validateQuery(terminalListQuerySchema)
export const validateTerminalIdParam = validateParam(terminalIdParamSchema)
