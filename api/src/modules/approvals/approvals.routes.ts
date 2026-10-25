import { requirePermission } from '../../http/authorize.ts'
import { factory } from '../../http/factory.ts'
import { requireSession } from '../../http/session.ts'
import * as approvalsController from './approvals.controller.ts'
import {
  validateApprovalDecision,
  validateApprovalIdParam,
  validateApprovalListQuery,
} from './approvals.validation.ts'

export const approvalsRoutes = factory.createApp()

approvalsRoutes.get(
  '/api/approvals',
  requireSession,
  requirePermission('procurement.read'),
  validateApprovalListQuery,
  (c) => approvalsController.listApprovals(c, c.req.valid('query')),
)

approvalsRoutes.get(
  '/api/approvals/:id',
  requireSession,
  requirePermission('procurement.read'),
  validateApprovalIdParam,
  (c) => approvalsController.getApproval(c, c.req.valid('param').id),
)

approvalsRoutes.post(
  '/api/approvals/:id/decide',
  requireSession,
  requirePermission('procurement.approve'),
  validateApprovalIdParam,
  validateApprovalDecision,
  (c) => approvalsController.decideApproval(c, c.req.valid('param').id, c.req.valid('json')),
)

approvalsRoutes.post(
  '/api/approvals/:id/withdraw',
  requireSession,
  requirePermission('procurement.read'),
  validateApprovalIdParam,
  (c) => approvalsController.withdrawApproval(c, c.req.valid('param').id),
)
