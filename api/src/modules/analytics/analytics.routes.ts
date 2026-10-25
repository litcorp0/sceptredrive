import { currentUser, requirePermission } from '../../http/authorize.ts'
import { factory } from '../../http/factory.ts'
import { rateLimit } from '../../http/rate-limit.ts'
import { requireSession } from '../../http/session.ts'
import * as analyticsController from './analytics.controller.ts'
import {
  validateAnalyticsQuery,
  validateProductsQuery,
  validateSalesQuery,
} from './analytics.validation.ts'

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

const exportRateLimit = rateLimit({
  windowMs: 60_000,
  max: 20,
  keyPrefix: 'analytics-export',
  keyForRequest: (c) => currentUser(c).id,
})

analyticsRoutes.get(
  '/api/analytics/sales',
  requireSession,
  requirePermission('analytics.read'),
  analyticsRateLimit,
  validateSalesQuery,
  (c) => analyticsController.getSales(c, c.req.valid('query')),
)

analyticsRoutes.get(
  '/api/analytics/products',
  requireSession,
  requirePermission('analytics.read'),
  analyticsRateLimit,
  validateProductsQuery,
  (c) => analyticsController.getProducts(c, c.req.valid('query')),
)

analyticsRoutes.get(
  '/api/analytics/tax',
  requireSession,
  requirePermission('analytics.read'),
  analyticsRateLimit,
  validateAnalyticsQuery,
  (c) => analyticsController.getTax(c, c.req.valid('query')),
)

analyticsRoutes.get(
  '/api/analytics/inventory',
  requireSession,
  requirePermission('analytics.read'),
  analyticsRateLimit,
  validateAnalyticsQuery,
  (c) => analyticsController.getInventory(c, c.req.valid('query')),
)

analyticsRoutes.get(
  '/api/analytics/credit',
  requireSession,
  requirePermission('analytics.read'),
  analyticsRateLimit,
  validateAnalyticsQuery,
  (c) => analyticsController.getCredit(c, c.req.valid('query')),
)

analyticsRoutes.get(
  '/api/analytics/loyalty',
  requireSession,
  requirePermission('analytics.read'),
  analyticsRateLimit,
  validateAnalyticsQuery,
  (c) => analyticsController.getLoyalty(c, c.req.valid('query')),
)

analyticsRoutes.get(
  '/api/analytics/payables',
  requireSession,
  requirePermission('analytics.read'),
  analyticsRateLimit,
  validateAnalyticsQuery,
  (c) => analyticsController.getPayables(c, c.req.valid('query')),
)

analyticsRoutes.get(
  '/api/analytics/sales/export',
  requireSession,
  requirePermission('analytics.read'),
  exportRateLimit,
  validateAnalyticsQuery,
  (c) => analyticsController.exportSales(c, c.req.valid('query')),
)

analyticsRoutes.get(
  '/api/analytics/products/export',
  requireSession,
  requirePermission('analytics.read'),
  exportRateLimit,
  validateAnalyticsQuery,
  (c) => analyticsController.exportProducts(c, c.req.valid('query')),
)

analyticsRoutes.get(
  '/api/analytics/tax/export',
  requireSession,
  requirePermission('analytics.read'),
  exportRateLimit,
  validateAnalyticsQuery,
  (c) => analyticsController.exportTax(c, c.req.valid('query')),
)

for (const exportRoute of [
  { path: '/api/analytics/inventory/export', handler: analyticsController.exportInventory },
  { path: '/api/analytics/credit/export', handler: analyticsController.exportCredit },
  { path: '/api/analytics/loyalty/export', handler: analyticsController.exportLoyalty },
  { path: '/api/analytics/payables/export', handler: analyticsController.exportPayables },
] as const) {
  analyticsRoutes.get(
    exportRoute.path,
    requireSession,
    requirePermission('analytics.read'),
    exportRateLimit,
    validateAnalyticsQuery,
    (c) => exportRoute.handler(c, c.req.valid('query')),
  )
}
