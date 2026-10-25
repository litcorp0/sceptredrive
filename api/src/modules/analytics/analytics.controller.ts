import type { Context } from 'hono'
import { currentUser } from '../../http/authorize.ts'
import type { AppEnv } from '../../http/factory.ts'
import * as analyticsService from './analytics.service.ts'
import type { AnalyticsQuery } from './analytics.types.ts'

/**
 * Analytics controllers are deliberately only plumbing: the validated query and the signed
 * in user go in, the service's read model comes out. No aggregation, no branch logic, no
 * formatting happens here.
 */
export async function getOverview(c: Context<AppEnv>, query: AnalyticsQuery) {
  const user = currentUser(c)
  return c.json(await analyticsService.getOverview({ user, query }))
}
