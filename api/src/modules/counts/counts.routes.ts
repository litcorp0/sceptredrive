import { requirePermission } from '../../http/authorize.ts'
import { factory } from '../../http/factory.ts'
import { requireSession } from '../../http/session.ts'
import * as countsController from './counts.controller.ts'
import {
  validateCountCreate,
  validateCountIdParam,
  validateCountLinesUpdate,
  validateCountListQuery,
} from './counts.validation.ts'

export const countsRoutes = factory.createApp()

countsRoutes.get(
  '/api/counts',
  requireSession,
  requirePermission('inventory.read'),
  validateCountListQuery,
  (c) => countsController.listCounts(c, c.req.valid('query')),
)

countsRoutes.post(
  '/api/counts',
  requireSession,
  requirePermission('inventory.count'),
  validateCountCreate,
  (c) => countsController.createCount(c, c.req.valid('json')),
)

countsRoutes.get(
  '/api/counts/:id',
  requireSession,
  requirePermission('inventory.read'),
  validateCountIdParam,
  (c) => countsController.getCount(c, c.req.valid('param').id),
)

countsRoutes.patch(
  '/api/counts/:id/lines',
  requireSession,
  requirePermission('inventory.count'),
  validateCountIdParam,
  validateCountLinesUpdate,
  (c) => countsController.updateCountLines(c, c.req.valid('param').id, c.req.valid('json')),
)

countsRoutes.post(
  '/api/counts/:id/post',
  requireSession,
  requirePermission('inventory.count'),
  validateCountIdParam,
  (c) => countsController.postCount(c, c.req.valid('param').id),
)

countsRoutes.post(
  '/api/counts/:id/cancel',
  requireSession,
  requirePermission('inventory.count'),
  validateCountIdParam,
  (c) => countsController.cancelCount(c, c.req.valid('param').id),
)
