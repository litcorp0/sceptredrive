import { z } from 'zod'
import { currentUser, requirePermission } from '../../http/authorize.ts'
import { factory } from '../../http/factory.ts'
import { requireSession } from '../../http/session.ts'
import { validateJson, validateQuery } from '../../http/validation.ts'
import { actorFromContext } from './audit.service.ts'
import { listSettings, updateSetting } from './settings.service.ts'

const listQuerySchema = z.object({
  branchId: z.uuid().optional(),
})

const updateSchema = z
  .object({
    key: z.string().trim().min(1).max(120),
    value: z.unknown(),
    branchId: z.uuid().nullish(),
  })
  .strict()

export const settingsRoutes = factory.createApp()

settingsRoutes.get(
  '/api/settings',
  requireSession,
  requirePermission('settings.read'),
  validateQuery(listQuerySchema),
  async (c) => {
    const user = currentUser(c)
    const result = await listSettings(user, c.req.valid('query').branchId ?? null)
    return c.json(result)
  },
)

settingsRoutes.patch(
  '/api/settings',
  requireSession,
  requirePermission('settings.update'),
  validateJson(updateSchema),
  async (c) => {
    const user = currentUser(c)
    const actor = actorFromContext(c)
    const setting = await updateSetting(user, actor, c.req.valid('json'))
    return c.json({ setting })
  },
)
