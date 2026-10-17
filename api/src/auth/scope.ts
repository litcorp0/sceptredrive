import { can, isRole, type Permission, type Role } from '@gikautos/shared'
import { ForbiddenError } from '../http/errors.ts'
import type { SessionUser } from '../http/factory.ts'

/** Resolves the role from the user record; unknown roles fail closed. */
export function roleOf(user: SessionUser): Role {
  const role = user.role
  return typeof role === 'string' && isRole(role) ? role : 'CASHIER'
}

/** Admins are unscoped; managers are scoped to their branch. */
export function branchScope(user: SessionUser): string | null {
  if (roleOf(user) === 'ADMIN') return null
  if (!user.branchId) throw new ForbiddenError('Your account is not assigned to a branch')
  return user.branchId
}

export function hasPermission(user: SessionUser, permission: Permission): boolean {
  return can(roleOf(user), permission)
}

export function assertBranchAccess(user: SessionUser, branchId: string): void {
  const scope = branchScope(user)
  if (scope !== null && scope !== branchId) {
    throw new ForbiddenError('You can only access your own branch')
  }
}

/**
 * Resolves the effective branch filter for a scoped query:
 * - admins get the requested branch (or null for all branches),
 * - managers always get their own branch; requesting another branch is denied.
 */
export function resolveBranchFilter(
  user: SessionUser,
  requestedBranchId?: string | null,
): string | null {
  if (roleOf(user) === 'ADMIN') return requestedBranchId ?? null

  const scope = branchScope(user)
  if (requestedBranchId && requestedBranchId !== scope) {
    throw new ForbiddenError('You can only access your own branch')
  }
  return scope
}
