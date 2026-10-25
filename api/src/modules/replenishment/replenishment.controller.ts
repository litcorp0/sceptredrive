import type { Context } from 'hono'
import { currentUser } from '../../http/authorize.ts'
import type { AppEnv } from '../../http/factory.ts'
import * as replenishmentService from './replenishment.service.ts'
import type {
  SuggestionsQueryInput,
  SupplierPerformanceQueryInput,
} from './replenishment.validation.ts'

export async function getSuggestions(c: Context<AppEnv>, query: SuggestionsQueryInput) {
  const user = currentUser(c)
  return c.json(await replenishmentService.getSuggestions(user, query))
}

export async function getSupplierPerformance(
  c: Context<AppEnv>,
  query: SupplierPerformanceQueryInput,
) {
  const user = currentUser(c)
  return c.json(await replenishmentService.getSupplierPerformance(user, query))
}
