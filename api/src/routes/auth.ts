import { auth } from '../auth/auth.ts'
import { factory } from '../http/factory.ts'

export const authRoutes = factory.createApp()

// Public sign-up is disabled: staff accounts are created by admins or managers.
authRoutes.all('/api/auth/sign-up/*', (c) => {
  return c.json(
    { error: { message: 'Resource not found', code: 'NOT_FOUND', requestId: c.get('requestId') } },
    404,
  )
})

authRoutes.all('/api/auth/*', (c) => {
  return auth.handler(c.req.raw)
})
