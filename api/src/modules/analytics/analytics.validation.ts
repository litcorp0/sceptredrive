import { z } from 'zod'
import { validateQuery } from '../../http/validation.ts'

/**
 * Shared query contract for every analytics endpoint.
 *
 * `from`/`to` are ISO dates and inclusive; the service widens `to` to the next midnight so
 * the query range is half-open. The 366-day cap and `from <= to` are service rules because
 * they need the Accra "today"; they throw a readable `ValidationError` rather than a Zod
 * message.
 */
export const analyticsQuerySchema = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
    granularity: z.enum(['day', 'week', 'month']).default('day'),
    branchId: z.uuid().optional(),
  })
  .strict()

export type AnalyticsQueryInput = z.infer<typeof analyticsQuerySchema>

export const validateAnalyticsQuery = validateQuery(analyticsQuerySchema)

const periodFields = {
  from: z.iso.date(),
  to: z.iso.date(),
  granularity: z.enum(['day', 'week', 'month']).default('day'),
  branchId: z.uuid().optional(),
}

const pagingFields = {
  direction: z.enum(['asc', 'desc']).default('desc'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
}

export const salesQuerySchema = z
  .object({
    ...periodFields,
    sort: z.enum(['date', 'take', 'count']).default('date'),
    ...pagingFields,
  })
  .strict()

export const productsQuerySchema = z
  .object({
    ...periodFields,
    sort: z.enum(['revenue', 'units', 'margin']).default('revenue'),
    categoryId: z.uuid().optional(),
    ...pagingFields,
  })
  .strict()

export const validateSalesQuery = validateQuery(salesQuerySchema)
export const validateProductsQuery = validateQuery(productsQuerySchema)

export type SalesQueryInput = z.infer<typeof salesQuerySchema>
export type ProductsQueryInput = z.infer<typeof productsQuerySchema>
