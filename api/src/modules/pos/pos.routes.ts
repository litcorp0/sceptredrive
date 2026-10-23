import { requirePermission } from '../../http/authorize.ts'
import { factory } from '../../http/factory.ts'
import { requireSession } from '../../http/session.ts'
import * as posController from './pos.controller.ts'
import { validateReconciliationQuery } from './pos.validation.ts'

export const posRoutes = factory.createApp()

posRoutes.get(
  '/api/pos/reconciliation',
  requireSession,
  requirePermission('inventory.read'),
  validateReconciliationQuery,
  (c) => posController.reconciliation(c, c.req.valid('query')),
)
