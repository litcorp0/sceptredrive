import { serve } from '@hono/node-server'
import { closeDb } from '@sceptre/db'
import { app } from './app.ts'
import { env } from './config/env.ts'
import { startJobs, stopJobs } from './jobs/index.ts'
import { logger } from './logger.ts'

const server = serve({ fetch: app.fetch, hostname: '0.0.0.0', port: env.API_PORT }, (info) =>
  logger.info({ port: info.port, environment: env.NODE_ENV }, 'api listening'),
)

// serve() returns a node:http server in practice; the union type also allows HTTP/2.
const httpServer = server as typeof server & { closeIdleConnections?: () => void }

try {
  await startJobs()
} catch (error) {
  logger.fatal({ err: error }, 'failed to start jobs')
  process.exit(1)
}

let shuttingDown = false

function shutdown(signal: string): void {
  if (shuttingDown) return
  shuttingDown = true
  logger.info({ signal }, 'shutting down')

  const deadline = setTimeout(() => {
    logger.error('graceful shutdown timed out, forcing exit')
    process.exit(1)
  }, 10_000)
  deadline.unref()

  httpServer.close(async (error) => {
    try {
      await stopJobs()
    } catch (stopError) {
      logger.error({ err: stopError }, 'failed to stop jobs')
    }
    try {
      await closeDb()
    } catch (closeError) {
      logger.error({ err: closeError }, 'failed to close the database pool')
    }
    clearTimeout(deadline)
    process.exit(error ? 1 : 0)
  })
  if (typeof httpServer.closeIdleConnections === 'function') {
    httpServer.closeIdleConnections()
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
