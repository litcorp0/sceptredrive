import { requirePermission } from '../../http/authorize.ts'
import { factory } from '../../http/factory.ts'
import { requireSession } from '../../http/session.ts'
import * as loyaltyController from './loyalty.controller.ts'
import {
  validateLiabilityQuery,
  validateLoyaltyAccountParam,
  validateLoyaltyEntryCreate,
} from './loyalty.validation.ts'

export const loyaltyRoutes = factory.createApp()

loyaltyRoutes.get(
  '/api/loyalty/accounts/:customerId',
  requireSession,
  requirePermission('loyalty.read'),
  validateLoyaltyAccountParam,
  (c) => loyaltyController.getAccount(c, c.req.valid('param').customerId),
)

loyaltyRoutes.post(
  '/api/loyalty/entries',
  requireSession,
  requirePermission('loyalty.adjust'),
  validateLoyaltyEntryCreate,
  (c) => loyaltyController.createEntry(c, c.req.valid('json')),
)

loyaltyRoutes.get(
  '/api/loyalty/liability',
  requireSession,
  requirePermission('loyalty.read'),
  validateLiabilityQuery,
  (c) => loyaltyController.getLiability(c, c.req.valid('query')),
)

loyaltyRoutes.post(
  '/api/loyalty/expiry-run',
  requireSession,
  requirePermission('loyalty.settings'),
  (c) => loyaltyController.runExpiry(c),
)
