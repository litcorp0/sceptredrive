import { logger } from '../logger.ts'
import { factory } from './factory.ts'

export const requestLogger = factory.createMiddleware(async (c, next) => {
  const start = performance.now()
  const requestId = c.get('requestId')
  const requestLogger = logger.child({ requestId })

  c.set('logger', requestLogger)

  await next()

  requestLogger.info(
    {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Math.round(performance.now() - start),
    },
    'request',
  )
})
