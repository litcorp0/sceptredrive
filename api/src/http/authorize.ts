import type { Permission } from '@sceptre/shared'
import type { Context } from 'hono'
import { hasPermission } from '../auth/scope.ts'
import { ForbiddenError, UnauthorizedError } from './errors.ts'
import { type AppEnv, factory, type SessionUser } from './factory.ts'

/** Reads the signed-in user or throws 401 (use after `requireSession`). */
export function currentUser(c: Context<AppEnv>): SessionUser {
  const user = c.get('user')
  if (!user) throw new UnauthorizedError()
  return user
}

/** Permission gate; deny by default. */
export function requirePermission(permission: Permission) {
  return factory.createMiddleware(async (c, next) => {
    const user = c.get('user')
    if (!user) throw new UnauthorizedError()
    if (!hasPermission(user, permission)) throw new ForbiddenError()
    await next()
  })
}
