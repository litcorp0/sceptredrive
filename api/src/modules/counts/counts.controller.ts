import type { Context } from 'hono'
import { actorFromContext } from '../../http/audit-context.ts'
import { currentUser } from '../../http/authorize.ts'
import type { AppEnv } from '../../http/factory.ts'
import * as countsService from './counts.service.ts'
import type { CountCreateInput, CountLinesUpdateInput, CountListQuery } from './counts.types.ts'

export async function listCounts(c: Context<AppEnv>, query: CountListQuery) {
  const user = currentUser(c)
  const result = await countsService.listCounts(user, query)
  return c.json(result)
}

export async function createCount(c: Context<AppEnv>, input: CountCreateInput) {
  const user = currentUser(c)
  const actor = actorFromContext(c)
  const count = await countsService.createCount(user, actor, input)
  return c.json({ count }, 201)
}

export async function getCount(c: Context<AppEnv>, id: string) {
  const user = currentUser(c)
  const count = await countsService.getCount(user, id)
  return c.json({ count })
}

export async function updateCountLines(
  c: Context<AppEnv>,
  id: string,
  input: CountLinesUpdateInput,
) {
  const user = currentUser(c)
  const actor = actorFromContext(c)
  const count = await countsService.updateCountLines(user, actor, id, input)
  return c.json({ count })
}

export async function postCount(c: Context<AppEnv>, id: string) {
  const user = currentUser(c)
  const actor = actorFromContext(c)
  const count = await countsService.postCount(user, actor, id)
  return c.json({ count })
}

export async function cancelCount(c: Context<AppEnv>, id: string) {
  const user = currentUser(c)
  const actor = actorFromContext(c)
  await countsService.cancelCount(user, actor, id)
  return c.json({ ok: true })
}
