import { z } from 'zod'
import { validateQuery } from '../../http/validation.ts'

/**
 * Replenishment reads are branch-scoped: a manager's own branch, an admin's
 * chosen one. `branchId` is optional here because a manager's scope supplies it;
 * the service refuses an admin request without a branch rather than mixing every
 * branch into one suggestion list.
 */
const limitSchema = z.coerce.number().int().min(1).max(200).default(50)
const offsetSchema = z.coerce.number().int().min(0).default(0)

export const suggestionsQuerySchema = z
  .object({
    branchId: z.uuid().optional(),
    supplierId: z.uuid().optional(),
    onlySuggested: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => value === 'true'),
    q: z.string().trim().min(2).max(120).optional(),
    limit: limitSchema,
    offset: offsetSchema,
  })
  .strict()

export const supplierPerformanceQuerySchema = z
  .object({
    branchId: z.uuid().optional(),
    supplierId: z.uuid().optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
  })
  .strict()

export type SuggestionsQueryInput = z.infer<typeof suggestionsQuerySchema>
export type SupplierPerformanceQueryInput = z.infer<typeof supplierPerformanceQuerySchema>

export const validateSuggestionsQuery = validateQuery(suggestionsQuerySchema)
export const validateSupplierPerformanceQuery = validateQuery(supplierPerformanceQuerySchema)
