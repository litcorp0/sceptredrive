import { requirePermission } from '../../http/authorize.ts'
import { factory } from '../../http/factory.ts'
import { requireSession } from '../../http/session.ts'
import * as customersController from './customers.controller.ts'
import {
  validateCustomerCreate,
  validateCustomerIdParam,
  validateCustomerListQuery,
  validateCustomerNote,
  validateCustomerUpdate,
} from './customers.validation.ts'

export const customersRoutes = factory.createApp()

customersRoutes.get(
  '/api/customers',
  requireSession,
  requirePermission('customer.read'),
  validateCustomerListQuery,
  (c) => customersController.listCustomers(c, c.req.valid('query')),
)

customersRoutes.post(
  '/api/customers',
  requireSession,
  requirePermission('customer.create'),
  validateCustomerCreate,
  (c) => customersController.createCustomer(c, c.req.valid('json')),
)

customersRoutes.get(
  '/api/customers/:id',
  requireSession,
  requirePermission('customer.read'),
  validateCustomerIdParam,
  (c) => customersController.getCustomer(c, c.req.valid('param').id),
)

customersRoutes.patch(
  '/api/customers/:id',
  requireSession,
  requirePermission('customer.update'),
  validateCustomerIdParam,
  validateCustomerUpdate,
  (c) => customersController.updateCustomer(c, c.req.valid('param').id, c.req.valid('json')),
)

customersRoutes.post(
  '/api/customers/:id/archive',
  requireSession,
  requirePermission('customer.archive'),
  validateCustomerIdParam,
  validateCustomerNote,
  (c) => customersController.archiveCustomer(c, c.req.valid('param').id, c.req.valid('json')),
)

customersRoutes.post(
  '/api/customers/:id/reactivate',
  requireSession,
  requirePermission('customer.archive'),
  validateCustomerIdParam,
  (c) => customersController.reactivateCustomer(c, c.req.valid('param').id),
)

customersRoutes.post(
  '/api/customers/:id/anonymize',
  requireSession,
  requirePermission('customer.anonymize'),
  validateCustomerIdParam,
  validateCustomerNote,
  (c) => customersController.anonymizeCustomer(c, c.req.valid('param').id, c.req.valid('json')),
)
