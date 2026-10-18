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
import { catalogRoutes } from './modules/catalog/catalog.routes.ts'
import { staffRoutes } from './modules/identity/staff.routes.ts'
import { inventoryRoutes } from './modules/inventory/inventory.routes.ts'
import { branchesRoutes } from './modules/org/branches.routes.ts'
import { enrollmentRoutes } from './modules/org/enrollment.routes.ts'
import { terminalsRoutes } from './modules/org/terminals.routes.ts'
import { auditRoutes } from './modules/platform/audit.routes.ts'
import { settingsRoutes } from './modules/platform/settings.routes.ts'
import { productsRoutes } from './modules/products/products.routes.ts'
import { transfersRoutes } from './modules/transfers/transfers.routes.ts'
import { authRoutes } from './routes/auth.ts'
import { healthRoutes } from './routes/health.ts'

export const app = factory.createApp()

app.use(requestId)
app.use(requestLogger)
app.use(loadSession)
app.use(securityHeaders)
app.use('*', corsMiddleware)

app.route('/', healthRoutes)
app.route('/', authRoutes)
app.route('/', branchesRoutes)
app.route('/', terminalsRoutes)
app.route('/', enrollmentRoutes)
app.route('/', staffRoutes)
app.route('/', catalogRoutes)
app.route('/', productsRoutes)
app.route('/', inventoryRoutes)
app.route('/', transfersRoutes)
app.route('/', auditRoutes)
app.route('/', settingsRoutes)

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
      { error: { message: error.message, code: error.code, requestId } },
      error.statusCode as 400 | 401 | 403 | 404 | 409 | 429,
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
