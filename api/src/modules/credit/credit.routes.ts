import { requirePermission } from '../../http/authorize.ts'
import { factory } from '../../http/factory.ts'
import { requireSession } from '../../http/session.ts'
import * as creditController from './credit.controller.ts'
import {
  validateCreditProfileParam,
  validateEntryCreate,
  validateEntryListQuery,
  validateProfileListQuery,
  validateProfileUpdate,
  validateRepaymentCreate,
} from './credit.validation.ts'

export const creditRoutes = factory.createApp()

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
