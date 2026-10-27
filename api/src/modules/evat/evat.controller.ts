import type { Context } from 'hono'
import { actorFromContext } from '../../http/audit-context.ts'
import { currentUser } from '../../http/authorize.ts'
import type { AppEnv } from '../../http/factory.ts'
import * as evatService from './evat.service.ts'
import type { EvatListQuery } from './evat.types.ts'

export async function listSubmissions(c: Context<AppEnv>, query: EvatListQuery) {
  const user = currentUser(c)
  return c.json(await evatService.listSubmissions(user, query))
}

export async function getSubmission(c: Context<AppEnv>, id: string) {
  const user = currentUser(c)
  const submission = await evatService.getSubmission(user, id)
  return c.json({ submission })
}

export async function retrySubmission(c: Context<AppEnv>, id: string) {
  const user = currentUser(c)
  const actor = actorFromContext(c)
  const submission = await evatService.retrySubmission(user, actor, id)
  return c.json({ submission })
}

export async function getSummary(c: Context<AppEnv>) {
  const user = currentUser(c)
  return c.json(await evatService.getSummary(user))
}

export async function getHealth(c: Context<AppEnv>) {
  return c.json({ health: await evatService.checkProviderHealth() })
}
