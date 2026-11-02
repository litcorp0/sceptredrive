import type { Context } from 'hono'
import { actorFromContext } from '../../http/audit-context.ts'
import { currentUser } from '../../http/authorize.ts'
import type { AppEnv } from '../../http/factory.ts'
import * as openingsService from './openings.service.ts'
import type {
  OpeningCreateInput,
  OpeningLineInput,
  OpeningListQuery,
  OpeningPostInput,
} from './openings.types.ts'

export async function previewOpening(
  c: Context<AppEnv>,
  input: { branchId: string; rows: OpeningLineInput[] },
) {
  const user = currentUser(c)
  return c.json(await openingsService.previewOpening(user, input))
}

export async function createOpening(c: Context<AppEnv>, input: OpeningCreateInput) {
  const user = currentUser(c)
  const actor = actorFromContext(c)
  return c.json(await openingsService.createOpening(user, actor, input), 201)
}

export async function listOpenings(c: Context<AppEnv>, query: OpeningListQuery) {
  const user = currentUser(c)
  return c.json(await openingsService.listOpenings(user, query))
}

export async function getOpening(c: Context<AppEnv>, id: string) {
  const user = currentUser(c)
  return c.json(await openingsService.getOpening(user, id))
}

export async function deleteOpening(c: Context<AppEnv>, id: string) {
  const user = currentUser(c)
  const actor = actorFromContext(c)
  await openingsService.deleteOpening(user, actor, id)
  return c.json({ ok: true })
}

export async function postOpening(c: Context<AppEnv>, id: string, input: OpeningPostInput) {
  const user = currentUser(c)
  const actor = actorFromContext(c)
  return c.json(await openingsService.postOpening(user, actor, id, input))
}
