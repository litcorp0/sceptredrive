import { requirePermission } from '../../http/authorize.ts'
import { factory } from '../../http/factory.ts'
import { requireSession } from '../../http/session.ts'
import * as payablesController from './payables.controller.ts'
import {
  validateAgingQuery,
  validateBalancesQuery,
  validateInvoiceCreate,
  validateInvoiceIdParam,
  validateInvoiceListQuery,
  validateInvoiceVoid,
  validatePaymentCreate,
  validatePaymentIdParam,
  validatePaymentListQuery,
  validatePaymentVoid,
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

payablesRoutes.get(
  '/api/payables/payments',
  requireSession,
  requirePermission('payable.read'),
  validatePaymentListQuery,
  (c) => payablesController.listPayments(c, c.req.valid('query')),
)

payablesRoutes.post(
  '/api/payables/payments',
  requireSession,
  requirePermission('payable.payment'),
  validatePaymentCreate,
  (c) => payablesController.createPayment(c, c.req.valid('json')),
)

payablesRoutes.get(
  '/api/payables/payments/:id',
  requireSession,
  requirePermission('payable.read'),
  validatePaymentIdParam,
  (c) => payablesController.getPayment(c, c.req.valid('param').id),
)

payablesRoutes.post(
  '/api/payables/payments/:id/void',
  requireSession,
  requirePermission('payable.void'),
  validatePaymentIdParam,
  validatePaymentVoid,
  (c) => payablesController.voidPayment(c, c.req.valid('param').id, c.req.valid('json')),
)

payablesRoutes.get(
  '/api/payables/balances',
  requireSession,
  requirePermission('payable.read'),
  validateBalancesQuery,
  (c) => payablesController.listBalances(c, c.req.valid('query')),
)

payablesRoutes.get(
  '/api/payables/aging',
  requireSession,
  requirePermission('payable.read'),
  validateAgingQuery,
  (c) => payablesController.getAging(c, c.req.valid('query')),
)

payablesRoutes.get(
  '/api/payables/aging/export',
  requireSession,
  requirePermission('payable.read'),
  validateAgingQuery,
  (c) => payablesController.exportAging(c, c.req.valid('query')),
)
