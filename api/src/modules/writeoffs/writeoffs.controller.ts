import type { Context } from 'hono'
import { actorFromContext } from '../../http/audit-context.ts'
import { currentUser } from '../../http/authorize.ts'
import type { AppEnv } from '../../http/factory.ts'
import * as writeOffsService from './writeoffs.service.ts'
import type { WriteOffCreateInput, WriteOffListQuery } from './writeoffs.types.ts'

export async function createWriteOff(c: Context<AppEnv>, input: WriteOffCreateInput) {
  const user = currentUser(c)
  const actor = actorFromContext(c)
  const detail = await writeOffsService.createWriteOff(user, actor, input)
  return c.json(detail, 201)
}

export async function listWriteOffs(c: Context<AppEnv>, query: WriteOffListQuery) {
  const user = currentUser(c)
  const result = await writeOffsService.listWriteOffs(user, query)
  return c.json(result)
}

export async function getWriteOff(c: Context<AppEnv>, id: string) {
  const user = currentUser(c)
  const detail = await writeOffsService.getWriteOff(user, id)
  return c.json(detail)
}

export async function cancelWriteOff(c: Context<AppEnv>, id: string) {
  const user = currentUser(c)
  const actor = actorFromContext(c)
  await writeOffsService.cancelWriteOff(user, actor, id)
  return c.json({ ok: true })
}
