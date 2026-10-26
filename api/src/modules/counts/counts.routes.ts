import { requirePermission } from '../../http/authorize.ts'
import { factory } from '../../http/factory.ts'
import { requireSession } from '../../http/session.ts'
import * as countsController from './counts.controller.ts'
import {
  validateAbcListQuery,
  validateAbcManual,
  validateAbcProductParam,
  validateAbcRecompute,
  validateCountAccuracyQuery,
  validateCountCreate,
  validateCountIdParam,
  validateCountLinesUpdate,
  validateCountListQuery,
  validateCountScheduleCreate,
  validateCountScheduleIdParam,
  validateCountScheduleListQuery,
  validateCountScheduleUpdate,
} from './counts.validation.ts'

export const countsRoutes = factory.createApp()

// --- Count schedules (P12-D28) ----------------------------------------------

countsRoutes.get(
  '/api/count-schedules',
  requireSession,
  requirePermission('inventory.read'),
  validateCountScheduleListQuery,
  (c) => countsController.listCountSchedules(c, c.req.valid('query')),
)

countsRoutes.post(
  '/api/count-schedules',
  requireSession,
  requirePermission('inventory.count'),
  validateCountScheduleCreate,
  (c) => countsController.createCountSchedule(c, c.req.valid('json')),
)

countsRoutes.patch(
  '/api/count-schedules/:id',
  requireSession,
  requirePermission('inventory.count'),
  validateCountScheduleIdParam,
  validateCountScheduleUpdate,
  (c) => countsController.updateCountSchedule(c, c.req.valid('param').id, c.req.valid('json')),
)

// --- ABC classes and accuracy (P12-D29, D33) ---------------------------------
// Registered before `/api/counts/:id`, or the uuid validator would swallow
// `accuracy` and `abc` as id parameters.

countsRoutes.get(
  '/api/counts/accuracy',
  requireSession,
  requirePermission('inventory.read'),
  validateCountAccuracyQuery,
  (c) => countsController.getCountAccuracy(c, c.req.valid('query')),
)

countsRoutes.get(
  '/api/counts/abc',
  requireSession,
  requirePermission('inventory.read'),
  validateAbcListQuery,
  (c) => countsController.listAbcClasses(c, c.req.valid('query')),
)

countsRoutes.post(
  '/api/counts/abc/recompute',
  requireSession,
  requirePermission('inventory.threshold'),
  validateAbcRecompute,
  (c) => countsController.recomputeAbcClasses(c, c.req.valid('json').branchId),
)

countsRoutes.patch(
  '/api/counts/abc/:productId',
  requireSession,
  requirePermission('inventory.threshold'),
  validateAbcProductParam,
  validateAbcManual,
  (c) =>
    countsController.setAbcClassManually(c, c.req.valid('param').productId, c.req.valid('json')),
)

// --- Stock counts ------------------------------------------------------------

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
