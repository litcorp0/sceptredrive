import { env } from '../config/env.ts'
import { factory } from './factory.ts'

export const securityHeaders = factory.createMiddleware(async (c, next) => {
  await next()

  c.header('x-content-type-options', 'nosniff')
  c.header('x-frame-options', 'DENY')
  c.header('referrer-policy', 'no-referrer')
  c.header('permissions-policy', 'camera=(), microphone=(), geolocation=()')
  c.header('cross-origin-resource-policy', 'same-site')
  c.header('content-security-policy', "default-src 'none'; frame-ancestors 'none'")

  if (env.NODE_ENV === 'production') {
    c.header('strict-transport-security', 'max-age=63072000; includeSubDomains')
  }
})
