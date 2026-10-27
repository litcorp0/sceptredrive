import { currentUser, requirePermission } from '../../http/authorize.ts'
import { factory } from '../../http/factory.ts'
import { rateLimit } from '../../http/rate-limit.ts'
import { requireSession } from '../../http/session.ts'
import * as posController from './pos.controller.ts'
import {
  validateOversightIdParam,
  validateOversightRefundsQuery,
  validateOversightSalesQuery,
  validateOversightShiftsQuery,
  validateReconciliationQuery,
} from './pos.validation.ts'

export const posRoutes = factory.createApp()

/**
 * Oversight is a read of documents, but a console that opens four panes at once
 * fires four calls, and a receipt copy reads settings, lines, tenders and a
 * certificate. The limiter is per user, not per IP: an office behind one NAT is
 * many people (the same rule as analytics).
 */
const oversightRateLimit = rateLimit({
  windowMs: 60_000,
  max: 120,
  keyPrefix: 'pos-oversight',
  keyForRequest: (c) => currentUser(c).id,
})

posRoutes.get(
  '/api/pos/reconciliation',
  requireSession,
  requirePermission('inventory.read'),
  validateReconciliationQuery,
  (c) => posController.reconciliation(c, c.req.valid('query')),
)

// Every oversight route is the same three gates in the same order: a session, the
// oversight permission (deny by default, P14-D5) and the per-user limiter. Branch
// scope is resolved from the caller inside the service, so a foreign branch id is
// a 403 and never a 404 that leaks existence (P14-D7, OWASP A01).
posRoutes.get(
  '/api/pos/oversight/sales',
  requireSession,
  requirePermission('pos.oversight.read'),
  oversightRateLimit,
  validateOversightSalesQuery,
  (c) => posController.listSales(c, c.req.valid('query')),
)

posRoutes.get(
  '/api/pos/oversight/sales/:id',
  requireSession,
  requirePermission('pos.oversight.read'),
  oversightRateLimit,
  validateOversightIdParam,
  (c) => posController.getSale(c, c.req.valid('param').id),
)

posRoutes.get(
  '/api/pos/oversight/refunds',
  requireSession,
  requirePermission('pos.oversight.read'),
  oversightRateLimit,
  validateOversightRefundsQuery,
  (c) => posController.listRefunds(c, c.req.valid('query')),
)

posRoutes.get(
  '/api/pos/oversight/refunds/:id',
  requireSession,
  requirePermission('pos.oversight.read'),
  oversightRateLimit,
  validateOversightIdParam,
  (c) => posController.getRefund(c, c.req.valid('param').id),
)

posRoutes.get(
  '/api/pos/oversight/shifts',
  requireSession,
  requirePermission('pos.oversight.read'),
  oversightRateLimit,
  validateOversightShiftsQuery,
  (c) => posController.listShifts(c, c.req.valid('query')),
)
