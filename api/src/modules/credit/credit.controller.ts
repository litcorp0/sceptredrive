import type { Context } from 'hono'
import { actorFromContext } from '../../http/audit-context.ts'
import { currentUser } from '../../http/authorize.ts'
import type { AppEnv } from '../../http/factory.ts'
import * as creditService from './credit.service.ts'
import type {
  AgingQuery,
  EntryCreateBody,
  EntryListQuery,
  ProfileListQuery,
  ProfileUpdateBody,
  RepaymentCreateBody,
  StatementQuery,
} from './credit.types.ts'

export async function listProfiles(c: Context<AppEnv>, query: ProfileListQuery) {
  const user = currentUser(c)
  return c.json(await creditService.listProfiles(user, query))
}

export async function updateProfile(
  c: Context<AppEnv>,
  customerId: string,
  input: ProfileUpdateBody,
) {
  const actor = actorFromContext(c)
  const user = currentUser(c)
  const profile = await creditService.updateProfile(actor, user, customerId, input)
  return c.json({ profile })
}

export async function createRepayment(c: Context<AppEnv>, input: RepaymentCreateBody) {
  const actor = actorFromContext(c)
  const user = currentUser(c)
  return c.json(await creditService.createRepayment(actor, user, input), 201)
}

export async function createEntry(c: Context<AppEnv>, input: EntryCreateBody) {
  const actor = actorFromContext(c)
  const user = currentUser(c)
  return c.json(await creditService.createEntry(actor, user, input), 201)
}

export async function listEntries(c: Context<AppEnv>, query: EntryListQuery) {
  const user = currentUser(c)
  return c.json(await creditService.listEntries(user, query))
}

export async function getAging(c: Context<AppEnv>, query: AgingQuery) {
  const user = currentUser(c)
  return c.json(await creditService.getAging(user, query))
}

export async function getStatement(c: Context<AppEnv>, customerId: string, query: StatementQuery) {
  const user = currentUser(c)
  return c.json(await creditService.getStatement(user, customerId, query))
}
