import { requirePermission } from '../../http/authorize.ts'
import { factory } from '../../http/factory.ts'
import { requireSession } from '../../http/session.ts'
import * as auditController from './audit.controller.ts'
import { validateAuditListQuery } from './audit.validation.ts'

export const auditRoutes = factory.createApp()

auditRoutes.get(
  '/api/audit',
  requireSession,
  requirePermission('audit.read'),
  validateAuditListQuery,
  (c) => auditController.listAudit(c, c.req.valid('query')),
)
