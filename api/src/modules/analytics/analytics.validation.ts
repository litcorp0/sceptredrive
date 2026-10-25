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
