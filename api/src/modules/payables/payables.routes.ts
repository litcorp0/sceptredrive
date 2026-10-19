import { requirePermission } from '../../http/authorize.ts'
import { factory } from '../../http/factory.ts'
import { requireSession } from '../../http/session.ts'
import * as payablesController from './payables.controller.ts'
import {
  validateInvoiceCreate,
  validateInvoiceIdParam,
  validateInvoiceListQuery,
  validateInvoiceVoid,
} from './payables.validation.ts'

export const payablesRoutes = factory.createApp()

payablesRoutes.get(
  '/api/payables/invoices',
  requireSession,
  requirePermission('payable.read'),
  validateInvoiceListQuery,
  (c) => payablesController.listInvoices(c, c.req.valid('query')),
)

payablesRoutes.post(
  '/api/payables/invoices',
  requireSession,
  requirePermission('payable.invoice.manage'),
  validateInvoiceCreate,
  (c) => payablesController.createInvoice(c, c.req.valid('json')),
)

payablesRoutes.get(
  '/api/payables/invoices/:id',
  requireSession,
  requirePermission('payable.read'),
  validateInvoiceIdParam,
  (c) => payablesController.getInvoice(c, c.req.valid('param').id),
)

payablesRoutes.post(
  '/api/payables/invoices/:id/void',
  requireSession,
  requirePermission('payable.void'),
  validateInvoiceIdParam,
  validateInvoiceVoid,
  (c) => payablesController.voidInvoice(c, c.req.valid('param').id, c.req.valid('json')),
)
