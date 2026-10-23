import { z } from 'zod'
import { validateQuery } from '../../http/validation.ts'

/** Admin reconciliation read; managers are pinned to their own branch. */
export const reconciliationQuerySchema = z.object({
  branchId: z.uuid().optional(),
})

export const validateReconciliationQuery = validateQuery(reconciliationQuerySchema)

export type ReconciliationQuery = z.infer<typeof reconciliationQuerySchema>
