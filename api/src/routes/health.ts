import { checkDb } from '@gikautos/db'
import { factory } from '../http/factory.ts'

export const healthRoutes = factory.createApp()

healthRoutes.get('/health', (c) => {
  return c.json({
    status: 'ok',
    version: '0.1.0',
    uptimeSeconds: Math.round(process.uptime()),
  })
})

healthRoutes.get('/ready', async (c) => {
  try {
    await checkDb()
    return c.json({ status: 'ready' })
  } catch (error) {
    c.get('logger').error({ err: error }, 'readiness check failed')
    return c.json({ status: 'unavailable' }, 503)
  }
})
