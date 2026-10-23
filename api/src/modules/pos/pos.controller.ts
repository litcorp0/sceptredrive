import type { Context } from 'hono'
import { resolveBranchFilter } from '../../auth/scope.ts'
import { currentUser } from '../../http/authorize.ts'
import type { AppEnv } from '../../http/factory.ts'
import { reconcilePos } from './pos.reconciliation.ts'
import type { ReconciliationQuery } from './pos.validation.ts'

/**
 * Read-only reconciliation for the console. Admins may ask for one branch or
 * all branches; managers are always pinned to their own branch. Divergences are
 * returned, never corrected.
 */
export async function reconciliation(c: Context<AppEnv>, query: ReconciliationQuery) {
  const user = currentUser(c)
  const branchId = resolveBranchFilter(user, query.branchId ?? null)
  const result = await reconcilePos(branchId)
  return c.json(result)
}
