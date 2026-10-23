import { requirePermission } from '../../http/authorize.ts'
import { factory } from '../../http/factory.ts'
import { requireFreshSession, requireSession } from '../../http/session.ts'
import * as staffController from './staff.controller.ts'
import {
  validateChangePassword,
  validateSetStaffPin,
  validateStaffCreate,
  validateStaffIdParam,
  validateStaffListQuery,
  validateStaffUpdate,
} from './staff.validation.ts'

export const staffRoutes = factory.createApp()

staffRoutes.get(
  '/api/staff',
  requireSession,
  requirePermission('staff.read'),
  validateStaffListQuery,
  (c) => staffController.listStaff(c, c.req.valid('query')),
)

staffRoutes.post(
  '/api/staff',
  requireSession,
  requirePermission('staff.create'),
  validateStaffCreate,
  (c) => staffController.createStaff(c, c.req.valid('json')),
)

staffRoutes.get(
  '/api/staff/:id',
  requireSession,
  requirePermission('staff.read'),
  validateStaffIdParam,
  (c) => staffController.getStaff(c, c.req.valid('param').id),
)

staffRoutes.patch(
  '/api/staff/:id',
  requireSession,
  requirePermission('staff.update'),
  validateStaffIdParam,
  validateStaffUpdate,
  (c) => staffController.updateStaff(c, c.req.valid('param').id, c.req.valid('json')),
)

staffRoutes.post(
  '/api/staff/:id/reset-password',
  requireSession,
  requireFreshSession,
  requirePermission('staff.reset-password'),
  validateStaffIdParam,
  (c) => staffController.resetStaffPassword(c, c.req.valid('param').id),
)

staffRoutes.post(
  '/api/staff/:id/pin',
  requireSession,
  requirePermission('staff.pin.reset'),
  validateStaffIdParam,
  validateSetStaffPin,
  (c) => staffController.setStaffPin(c, c.req.valid('param').id, c.req.valid('json')),
)

staffRoutes.get(
  '/api/staff/:id/pin-status',
  requireSession,
  requirePermission('staff.read'),
  validateStaffIdParam,
  (c) => staffController.getStaffPinState(c, c.req.valid('param').id),
)

staffRoutes.post(
  '/api/staff/:id/deactivate',
  requireSession,
  requirePermission('staff.update'),
  validateStaffIdParam,
  (c) => staffController.deactivateStaff(c, c.req.valid('param').id),
)

staffRoutes.post(
  '/api/staff/:id/reactivate',
  requireSession,
  requirePermission('staff.update'),
  validateStaffIdParam,
  (c) => staffController.reactivateStaff(c, c.req.valid('param').id),
)

// requireSession admits this path even while mustChangePassword is set.
staffRoutes.post(
  '/api/me/password',
  requireSession,
  requireFreshSession,
  validateChangePassword,
  (c) => staffController.changeOwnPassword(c, c.req.valid('json')),
)
