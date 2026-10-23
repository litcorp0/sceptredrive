import type { Context } from 'hono'
import { AppError } from './errors.ts'
import { type AppEnv, factory } from './factory.ts'
import { clientIpFromHeaders } from './request-meta.ts'

interface Bucket {
  count: number
  resetAt: number
}

export interface RateLimitOptions {
  windowMs: number
  max: number
  keyPrefix?: string
  /**
   * Bucket key override. Device-authenticated endpoints bucket per device (all
   * terminals behind one shop NAT share an IP); the default is the client IP.
   */
  keyForRequest?: (c: Context<AppEnv>) => string | null
}

/**
 * Minimal in-memory fixed-window rate limiter for endpoints outside Better
 * Auth's coverage (e.g. the device enrollment redeem endpoint). The API runs
 * as a single instance per environment; a shared store arrives with the
 * production hardening phase if the API is ever scaled out.
 */
export function rateLimit(options: RateLimitOptions) {
  const buckets = new Map<string, Bucket>()

  return factory.createMiddleware(async (c, next) => {
    const subject =
      options.keyForRequest?.(c) ?? clientIpFromHeaders(c.req.raw.headers) ?? 'unknown'
    const key = `${options.keyPrefix ?? c.req.path}:${subject}`
    const now = Date.now()
    const bucket = buckets.get(key)

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs })
    } else {
      bucket.count += 1
      if (bucket.count > options.max) {
        c.header('retry-after', String(Math.ceil((bucket.resetAt - now) / 1000)))
        throw new AppError(429, 'RATE_LIMITED', 'Too many requests, please try again later')
      }
    }

    if (buckets.size > 1000) {
      for (const [bucketKey, value] of buckets) {
        if (value.resetAt <= now) buckets.delete(bucketKey)
      }
    }

    await next()
  })
}
