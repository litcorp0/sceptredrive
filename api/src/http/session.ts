import { auth, SESSION_FRESH_AGE_SECONDS } from '../auth/auth.ts'
import { AppError, ForbiddenError, UnauthorizedError } from './errors.ts'
import { factory } from './factory.ts'

const AUTH_MOUNT_PREFIX = '/api/auth/'
const PUBLIC_PATHS = new Set(['/health', '/ready'])
const PASSWORD_CHANGE_PATHS = new Set(['/api/me/password'])

/**
 * Resolves the Better Auth session for API routes and stores it on the
 * context. Never throws: a lookup failure is treated as anonymous.
 *
 * The cookie cache is deliberately bypassed: authorization must reflect
 * role, branch, isActive, and mustChangePassword changes immediately, not
 * after the cache's 5-minute max age.
 */
export const loadSession = factory.createMiddleware(async (c, next) => {
  const path = c.req.path
  if (path.startsWith(AUTH_MOUNT_PREFIX) || PUBLIC_PATHS.has(path)) {
    await next()
    return
  }

  let result: Awaited<ReturnType<typeof auth.api.getSession>> = null
  try {
    result = await auth.api.getSession({
      headers: c.req.raw.headers,
      query: { disableCookieCache: true },
    })
  } catch (error) {
    c.get('logger').warn({ err: error }, 'session lookup failed')
    result = null
  }

  c.set('session', result?.session ?? null)
  c.set('user', result?.user ?? null)
  await next()
})

/**
 * Deny-by-default session gate. Deactivated accounts are rejected, and
 * accounts that still owe a password change may only reach the password
 * change endpoint. Requests without a session receive 401.
 */
export const requireSession = factory.createMiddleware(async (c, next) => {
  const user = c.get('user')
  if (!user) throw new UnauthorizedError()

  if (user.isActive !== true) {
    throw new ForbiddenError('This account has been deactivated')
  }

  if (user.mustChangePassword === true && !PASSWORD_CHANGE_PATHS.has(c.req.path)) {
    throw new ForbiddenError('A password change is required before continuing')
  }

  await next()
})

/**
 * Sensitive mutations require a session created within the fresh window.
 * Better Auth measures freshness from `session.createdAt`, and so do we.
 */
export const requireFreshSession = factory.createMiddleware(async (c, next) => {
  const session = c.get('session')
  if (!session) throw new UnauthorizedError()

  const createdAt =
    session.createdAt instanceof Date ? session.createdAt : new Date(session.createdAt)
  const ageSeconds = (Date.now() - createdAt.getTime()) / 1000

  if (!Number.isFinite(ageSeconds) || ageSeconds > SESSION_FRESH_AGE_SECONDS) {
    throw new AppError(403, 'REAUTH_REQUIRED', 'Please sign in again to continue')
  }

  await next()
})
