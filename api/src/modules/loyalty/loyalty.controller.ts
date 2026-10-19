import type { Context } from 'hono'
import { actorFromContext } from '../../http/audit-context.ts'
import { currentUser } from '../../http/authorize.ts'
import type { AppEnv } from '../../http/factory.ts'
import * as loyaltyService from './loyalty.service.ts'
import type { LiabilityQuery, LoyaltyEntryCreateBody } from './loyalty.types.ts'

export async function getAccount(c: Context<AppEnv>, customerId: string) {
  return c.json(await loyaltyService.getAccountDetail(customerId))
}

export async function createEntry(c: Context<AppEnv>, input: LoyaltyEntryCreateBody) {
  const actor = actorFromContext(c)
  const user = currentUser(c)
  return c.json(await loyaltyService.createEntry(actor, user, input), 201)
}

export async function getLiability(c: Context<AppEnv>, query: LiabilityQuery) {
  const user = currentUser(c)
  return c.json(await loyaltyService.getLiability(user, query))
}
