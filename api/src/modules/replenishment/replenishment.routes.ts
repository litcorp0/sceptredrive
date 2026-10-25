import { requirePermission } from '../../http/authorize.ts'
import { factory } from '../../http/factory.ts'
import { requireSession } from '../../http/session.ts'
import * as replenishmentController from './replenishment.controller.ts'
import {
  validateSuggestionsQuery,
  validateSupplierPerformanceQuery,
} from './replenishment.validation.ts'

/**
 * Replenishment routes. Both are reads: nothing here writes a table, and the
 * order they propose is created through `POST /api/procurement/orders`.
 */
export const replenishmentRoutes = factory.createApp()

replenishmentRoutes.get(
  '/api/replenishment/suggestions',
  requireSession,
  requirePermission('procurement.read'),
  validateSuggestionsQuery,
  (c) => replenishmentController.getSuggestions(c, c.req.valid('query')),
)

replenishmentRoutes.get(
  '/api/replenishment/suppliers/performance',
  requireSession,
  requirePermission('procurement.read'),
  validateSupplierPerformanceQuery,
  (c) => replenishmentController.getSupplierPerformance(c, c.req.valid('query')),
)
