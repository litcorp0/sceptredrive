import { HTTPException } from 'hono/http-exception'
import { env } from './config/env.ts'
import { corsMiddleware } from './http/cors.ts'
import { AppError } from './http/errors.ts'
import { factory } from './http/factory.ts'
import { requestLogger } from './http/logging.ts'
import { requestId } from './http/request-id.ts'
import { securityHeaders } from './http/security-headers.ts'
import { loadSession } from './http/session.ts'
import { logger } from './logger.ts'
import { analyticsRoutes } from './modules/analytics/analytics.routes.ts'
import { approvalsRoutes } from './modules/approvals/approvals.routes.ts'
import {
  assertDecisionHandlersRegistered,
  assertSubjectLoadersRegistered,
} from './modules/approvals/approvals.service.ts'
import { catalogRoutes } from './modules/catalog/catalog.routes.ts'
import { countsRoutes } from './modules/counts/counts.routes.ts'
import { creditRoutes } from './modules/credit/credit.routes.ts'
import { customersRoutes } from './modules/customers/customers.routes.ts'
import { staffRoutes } from './modules/identity/staff.routes.ts'
import { inventoryRoutes } from './modules/inventory/inventory.routes.ts'
import { loyaltyRoutes } from './modules/loyalty/loyalty.routes.ts'
import { operationsRoutes } from './modules/operations/operations.routes.ts'
import { branchesRoutes } from './modules/org/branches.routes.ts'
import { enrollmentRoutes } from './modules/org/enrollment.routes.ts'
import { terminalsRoutes } from './modules/org/terminals.routes.ts'
import { payablesRoutes } from './modules/payables/payables.routes.ts'
import { auditRoutes } from './modules/platform/audit.routes.ts'
import { settingsRoutes } from './modules/platform/settings.routes.ts'
import { posRoutes } from './modules/pos/pos.routes.ts'
import { procurementRoutes } from './modules/procurement/procurement.routes.ts'
import { productsRoutes } from './modules/products/products.routes.ts'
import { replenishmentRoutes } from './modules/replenishment/replenishment.routes.ts'
import { suppliersRoutes } from './modules/suppliers/suppliers.routes.ts'
import { syncRoutes } from './modules/sync/sync.routes.ts'
import { transfersRoutes } from './modules/transfers/transfers.routes.ts'
import { writeOffsRoutes } from './modules/writeoffs/writeoffs.routes.ts'
import { authRoutes } from './routes/auth.ts'
import { authPolicyRoutes } from './routes/auth-policy.ts'
import { healthRoutes } from './routes/health.ts'
import { jwksRoutes } from './routes/jwks.ts'

// Fail at boot, not at the first click: a request type that can be created but
// neither decided nor rendered is a programming error. Plans 04–08 each add their
// own type to both lists in the commit that registers its handler and loader;
// asserting a type before either exists would fail every intermediate boot.
assertDecisionHandlersRegistered([
  'PRODUCT_CREATE',
  'PURCHASE_ORDER',
  'TRANSFER_REQUEST',
  'STOCK_WRITE_OFF',
  'PRICE_CHANGE',
  'CREDIT_LIMIT_CHANGE',
  'SHIFT_VARIANCE_REVIEW',
])
assertSubjectLoadersRegistered([
  'PRODUCT_CREATE',
  'PURCHASE_ORDER',
  'TRANSFER_REQUEST',
  'STOCK_WRITE_OFF',
  'PRICE_CHANGE',
  'CREDIT_LIMIT_CHANGE',
  'SHIFT_VARIANCE_REVIEW',
])

export const app = factory.createApp()

app.use(requestId)
app.use(requestLogger)
app.use(loadSession)
app.use(securityHeaders)
app.use('*', corsMiddleware)

app.route('/', healthRoutes)
app.route('/', jwksRoutes)
// Before the Better Auth catch-all: `/api/auth/policy` is our route.
app.route('/', authPolicyRoutes)
app.route('/', authRoutes)
app.route('/', branchesRoutes)
app.route('/', terminalsRoutes)
app.route('/', enrollmentRoutes)
app.route('/', staffRoutes)
app.route('/', analyticsRoutes)
app.route('/', approvalsRoutes)
app.route('/', catalogRoutes)
app.route('/', productsRoutes)
app.route('/', inventoryRoutes)
app.route('/', transfersRoutes)
app.route('/', writeOffsRoutes)
app.route('/', countsRoutes)
app.route('/', customersRoutes)
app.route('/', creditRoutes)
app.route('/', loyaltyRoutes)
app.route('/', operationsRoutes)
app.route('/', suppliersRoutes)
app.route('/', payablesRoutes)
app.route('/', posRoutes)
app.route('/', procurementRoutes)
app.route('/', replenishmentRoutes)
app.route('/', auditRoutes)
app.route('/', settingsRoutes)
app.route('/', syncRoutes)

app.notFound((c) => {
  return c.json(
    { error: { message: 'Resource not found', code: 'NOT_FOUND', requestId: c.get('requestId') } },
    404,
  )
})

app.onError((error, c) => {
  const requestId = c.get('requestId') ?? 'unknown'
  const requestLogger = c.get('logger') ?? logger

  if (error instanceof AppError) {
    requestLogger.warn({ err: error, requestId }, 'application error')
    return c.json(
      {
        error: {
          message: error.message,
          code: error.code,
          ...(error.details ? { details: error.details } : {}),
          requestId,
        },
      },
      error.statusCode as 400 | 401 | 403 | 404 | 409 | 429 | 500 | 503,
    )
  }

  if (error instanceof HTTPException) {
    return c.json(
      { error: { message: error.message, code: 'HTTP_ERROR', requestId } },
      error.status,
    )
  }

  requestLogger.error({ err: error, requestId, environment: env.NODE_ENV }, 'unhandled error')
  return c.json({ error: { message: 'Internal server error', code: 'INTERNAL', requestId } }, 500)
})
