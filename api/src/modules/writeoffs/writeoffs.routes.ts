import { requirePermission } from '../../http/authorize.ts'
import { factory } from '../../http/factory.ts'
import { requireSession } from '../../http/session.ts'
import * as writeOffsController from './writeoffs.controller.ts'
import {
  validateWriteOffCreate,
  validateWriteOffIdParam,
  validateWriteOffListQuery,
} from './writeoffs.validation.ts'

export const writeOffsRoutes = factory.createApp()

writeOffsRoutes.get(
  '/api/write-offs',
  requireSession,
  requirePermission('inventory.read'),
  validateWriteOffListQuery,
  (c) => writeOffsController.listWriteOffs(c, c.req.valid('query')),
)

writeOffsRoutes.post(
  '/api/write-offs',
  requireSession,
  requirePermission('inventory.adjust'),
  validateWriteOffCreate,
  (c) => writeOffsController.createWriteOff(c, c.req.valid('json')),
)

writeOffsRoutes.get(
  '/api/write-offs/:id',
  requireSession,
  requirePermission('inventory.read'),
  validateWriteOffIdParam,
  (c) => writeOffsController.getWriteOff(c, c.req.valid('param').id),
)

writeOffsRoutes.post(
  '/api/write-offs/:id/cancel',
  requireSession,
  requirePermission('inventory.adjust'),
  validateWriteOffIdParam,
  (c) => writeOffsController.cancelWriteOff(c, c.req.valid('param').id),
)
