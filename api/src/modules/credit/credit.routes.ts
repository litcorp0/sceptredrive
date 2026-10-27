import { requirePermission } from '../../http/authorize.ts'
import { factory } from '../../http/factory.ts'
import { requireSession } from '../../http/session.ts'
import * as creditController from './credit.controller.ts'
import {
  validateAgingQuery,
  validateCreditLimitRequest,
  validateCreditProfileParam,
  validateEntryCreate,
  validateEntryListQuery,
  validateOverLimitQuery,
  validateProfileListQuery,
  validateProfileUpdate,
  validateRepaymentCreate,
  validateStatementParam,
  validateStatementQuery,
} from './credit.validation.ts'

export const creditRoutes = factory.createApp()

creditRoutes.get(
  '/api/credit/over-limit',
  requireSession,
  requirePermission('credit.read'),
  validateOverLimitQuery,
  (c) => creditController.listOverLimit(c, c.req.valid('query')),
)

creditRoutes.get(
  '/api/credit/profiles',
  requireSession,
  requirePermission('credit.read'),
  validateProfileListQuery,
  (c) => creditController.listProfiles(c, c.req.valid('query')),
)

creditRoutes.put(
  '/api/credit/profiles/:customerId',
  requireSession,
  requirePermission('credit.profile.manage'),
  validateCreditProfileParam,
  validateProfileUpdate,
  (c) => creditController.updateProfile(c, c.req.valid('param').customerId, c.req.valid('json')),
)

creditRoutes.post(
  '/api/credit/profiles/:customerId/limit-requests',
  requireSession,
  requirePermission('credit.profile.manage'),
  validateCreditProfileParam,
  validateCreditLimitRequest,
  (c) =>
    creditController.requestLimitIncrease(c, c.req.valid('param').customerId, c.req.valid('json')),
)

creditRoutes.post(
  '/api/credit/repayments',
  requireSession,
  requirePermission('credit.repayment'),
  validateRepaymentCreate,
  (c) => creditController.createRepayment(c, c.req.valid('json')),
)

creditRoutes.post(
  '/api/credit/entries',
  requireSession,
  requirePermission('credit.adjust'),
  validateEntryCreate,
  (c) => creditController.createEntry(c, c.req.valid('json')),
)

creditRoutes.get(
  '/api/credit/entries',
  requireSession,
  requirePermission('credit.read'),
  validateEntryListQuery,
  (c) => creditController.listEntries(c, c.req.valid('query')),
)

creditRoutes.get(
  '/api/credit/aging',
  requireSession,
  requirePermission('credit.read'),
  validateAgingQuery,
  (c) => creditController.getAging(c, c.req.valid('query')),
)

creditRoutes.get(
  '/api/credit/aging/export',
  requireSession,
  requirePermission('credit.read'),
  validateAgingQuery,
  (c) => creditController.exportAging(c, c.req.valid('query')),
)

creditRoutes.get(
  '/api/credit/statements/:customerId',
  requireSession,
  requirePermission('credit.read'),
  validateStatementParam,
  validateStatementQuery,
  (c) => creditController.getStatement(c, c.req.valid('param').customerId, c.req.valid('query')),
)
