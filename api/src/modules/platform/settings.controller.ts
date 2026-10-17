import type { Context } from 'hono'
import { actorFromContext } from '../../http/audit-context.ts'
import { currentUser } from '../../http/authorize.ts'
import type { AppEnv } from '../../http/factory.ts'
import * as settingsService from './settings.service.ts'
import type { SettingsListQuery, SettingsUpdateBody } from './settings.types.ts'

export async function listSettings(c: Context<AppEnv>, query: SettingsListQuery) {
  const user = currentUser(c)
  const result = await settingsService.listSettings(user, query.branchId ?? null)
  return c.json(result)
}

export async function updateSetting(c: Context<AppEnv>, body: SettingsUpdateBody) {
  const user = currentUser(c)
  const actor = actorFromContext(c)
  const setting = await settingsService.updateSetting(user, actor, body)
  return c.json({ setting })
}
