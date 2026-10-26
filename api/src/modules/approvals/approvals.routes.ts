import { requirePermission } from '../../http/authorize.ts'
import { factory } from '../../http/factory.ts'
import { requireSession } from '../../http/session.ts'
import * as approvalsController from './approvals.controller.ts'
import {
  validateApprovalDecision,
  validateApprovalIdParam,
  validateApprovalListQuery,
  validateApprovalSummaryQuery,
} from './approvals.validation.ts'

export const approvalsRoutes = factory.createApp()

approvalsRoutes.get(
  '/api/approvals',
  requireSession,
  requirePermission('approval.read'),
  validateApprovalListQuery,
  (c) => approvalsController.listApprovals(c, c.req.valid('query')),
)

// Before `/:id`: a literal path registered after the param route is swallowed by
// the uuid validator, which would answer 400 for `summary`.
approvalsRoutes.get(
  '/api/approvals/summary',
  requireSession,
  requirePermission('approval.read'),
  validateApprovalSummaryQuery,
  (c) => approvalsController.getApprovalSummary(c, c.req.valid('query').branchId),
)

approvalsRoutes.get(
  '/api/approvals/:id',
  requireSession,
  requirePermission('approval.read'),
  validateApprovalIdParam,
  (c) => approvalsController.getApproval(c, c.req.valid('param').id),
)

approvalsRoutes.post(
  '/api/approvals/:id/decide',
  requireSession,
  requirePermission('approval.decide'),
  validateApprovalIdParam,
  validateApprovalDecision,
  (c) => approvalsController.decideApproval(c, c.req.valid('param').id, c.req.valid('json')),
)

approvalsRoutes.post(
  '/api/approvals/:id/withdraw',
  requireSession,
  requirePermission('approval.read'),
  validateApprovalIdParam,
  (c) => approvalsController.withdrawApproval(c, c.req.valid('param').id),
)
