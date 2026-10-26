import { requirePermission } from '../../http/authorize.ts'
import { factory } from '../../http/factory.ts'
import { requireSession } from '../../http/session.ts'
import * as operationsController from './operations.controller.ts'
import { validateOperationsSummaryQuery } from './operations.validation.ts'

/**
 * The manager's branch view (Plan 12-10, P12-D37).
 *
 * One read, gated by `approval.read`: the view is the approvals inbox plus the
 * queues that feed it, and a caller who cannot see a request cannot see the
 * count of requests either. The service narrows to the caller's branch a second
 * time — the route decides whether, the service decides which.
 */
export const operationsRoutes = factory.createApp()

operationsRoutes.get(
  '/api/operations/summary',
  requireSession,
  requirePermission('approval.read'),
  validateOperationsSummaryQuery,
  (c) => operationsController.getSummary(c, c.req.valid('query')),
)
