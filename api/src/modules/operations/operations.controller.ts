import type { Context } from 'hono'
import { currentUser } from '../../http/authorize.ts'
import type { AppEnv } from '../../http/factory.ts'
import * as operationsService from './operations.service.ts'
import type { OperationsSummaryQuery } from './operations.validation.ts'

/** One handler: the summary is a read and takes no body, no id. */
export async function getSummary(c: Context<AppEnv>, query: OperationsSummaryQuery) {
  const user = currentUser(c)
  return c.json(await operationsService.getOperationsSummary(user, query))
}
