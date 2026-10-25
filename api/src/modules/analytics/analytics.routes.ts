import { currentUser, requirePermission } from '../../http/authorize.ts'
import { factory } from '../../http/factory.ts'
import { rateLimit } from '../../http/rate-limit.ts'
import { requireSession } from '../../http/session.ts'
import * as analyticsController from './analytics.controller.ts'
import { validateAnalyticsQuery } from './analytics.validation.ts'

export const analyticsRoutes = factory.createApp()

/**
 * Read-only aggregates are cheap per call but not free, and a tab switcher can fire several
 * at once. The limiter is per user, not per IP: an office behind one NAT is many people.
 */
const analyticsRateLimit = rateLimit({
  windowMs: 60_000,
  max: 120,
  keyPrefix: 'analytics',
  keyForRequest: (c) => currentUser(c).id,
})

analyticsRoutes.get(
  '/api/analytics/overview',
  requireSession,
  requirePermission('analytics.read'),
  analyticsRateLimit,
  validateAnalyticsQuery,
  (c) => analyticsController.getOverview(c, c.req.valid('query')),
)
