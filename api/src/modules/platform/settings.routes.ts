import { requirePermission } from '../../http/authorize.ts'
import { factory } from '../../http/factory.ts'
import { requireSession } from '../../http/session.ts'
import * as settingsController from './settings.controller.ts'
import { validateSettingsListQuery, validateSettingsUpdate } from './settings.validation.ts'

export const settingsRoutes = factory.createApp()

settingsRoutes.get(
  '/api/settings',
  requireSession,
  requirePermission('settings.read'),
  validateSettingsListQuery,
  (c) => settingsController.listSettings(c, c.req.valid('query')),
)

settingsRoutes.patch(
  '/api/settings',
  requireSession,
  requirePermission('settings.update'),
  validateSettingsUpdate,
  (c) => settingsController.updateSetting(c, c.req.valid('json')),
)
