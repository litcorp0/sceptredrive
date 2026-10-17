import { requirePermission } from '../../http/authorize.ts'
import { factory } from '../../http/factory.ts'
import { rateLimit } from '../../http/rate-limit.ts'
import { requireSession } from '../../http/session.ts'
import * as enrollmentController from './enrollment.controller.ts'
import {
  validateEnrollmentTerminalIdParam,
  validateRedeemEnrollmentBody,
} from './enrollment.validation.ts'

export const enrollmentRoutes = factory.createApp()

enrollmentRoutes.post(
  '/api/terminals/:id/enrollment',
  requireSession,
  requirePermission('terminal.update'),
  validateEnrollmentTerminalIdParam,
  (c) => enrollmentController.createEnrollment(c, c.req.valid('param').id),
)

// Device-facing: the POS redeems an enrollment code before it has credentials.
enrollmentRoutes.post(
  '/api/enrollments/redeem',
  rateLimit({ windowMs: 60_000, max: 10, keyPrefix: 'enrollments:redeem' }),
  validateRedeemEnrollmentBody,
  (c) => enrollmentController.redeemEnrollment(c, c.req.valid('json')),
)
