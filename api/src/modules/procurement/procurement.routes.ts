import { requirePermission } from '../../http/authorize.ts'
import { factory } from '../../http/factory.ts'
import { requireSession } from '../../http/session.ts'
import * as procurementController from './procurement.controller.ts'
import {
  validateMatchableOrdersQuery,
  validateOrderCancel,
  validateOrderClose,
  validateOrderCreate,
  validateOrderFromSuggestions,
  validateOrderIdParam,
  validateOrderListQuery,
  validateOrderUpdate,
  validateReceiveOrder,
  validateReturnCancel,
  validateReturnCreate,
  validateReturnListQuery,
} from './procurement.validation.ts'

export const procurementRoutes = factory.createApp()

procurementRoutes.get(
  '/api/procurement/orders',
  requireSession,
  requirePermission('procurement.read'),
  validateOrderListQuery,
  (c) => procurementController.listOrders(c, c.req.valid('query')),
)

procurementRoutes.post(
  '/api/procurement/orders',
  requireSession,
  requirePermission('procurement.create'),
  validateOrderCreate,
  (c) => procurementController.createOrder(c, c.req.valid('json')),
)

// Static before param, and the same path shape as `/orders`: a suggestion is a
// proposal, so it creates a DRAFT order through the normal lifecycle.
procurementRoutes.post(
  '/api/procurement/orders/from-suggestions',
  requireSession,
  requirePermission('procurement.create'),
  validateOrderFromSuggestions,
  (c) => procurementController.createOrderFromSuggestions(c, c.req.valid('json')),
)

// Static before param: otherwise `/orders/matchable` matches `:id`.
procurementRoutes.get(
  '/api/procurement/orders/matchable',
  requireSession,
  requirePermission('procurement.read'),
  validateMatchableOrdersQuery,
  (c) => procurementController.listMatchableOrders(c, c.req.valid('query')),
)

procurementRoutes.get(
  '/api/procurement/orders/:id',
  requireSession,
  requirePermission('procurement.read'),
  validateOrderIdParam,
  (c) => procurementController.getOrder(c, c.req.valid('param').id),
)

procurementRoutes.patch(
  '/api/procurement/orders/:id',
  requireSession,
  requirePermission('procurement.create'),
  validateOrderIdParam,
  validateOrderUpdate,
  (c) => procurementController.updateOrder(c, c.req.valid('param').id, c.req.valid('json')),
)

procurementRoutes.post(
  '/api/procurement/orders/:id/submit',
  requireSession,
  requirePermission('procurement.create'),
  validateOrderIdParam,
  (c) => procurementController.submitOrder(c, c.req.valid('param').id),
)

procurementRoutes.post(
  '/api/procurement/orders/:id/send',
  requireSession,
  requirePermission('procurement.create'),
  validateOrderIdParam,
  (c) => procurementController.sendOrder(c, c.req.valid('param').id),
)

procurementRoutes.post(
  '/api/procurement/orders/:id/cancel',
  requireSession,
  requirePermission('procurement.create'),
  validateOrderIdParam,
  validateOrderCancel,
  (c) => procurementController.cancelOrder(c, c.req.valid('param').id, c.req.valid('json')),
)

procurementRoutes.post(
  '/api/procurement/orders/:id/close',
  requireSession,
  requirePermission('procurement.create'),
  validateOrderIdParam,
  validateOrderClose,
  (c) => procurementController.closeOrder(c, c.req.valid('param').id, c.req.valid('json')),
)

procurementRoutes.post(
  '/api/procurement/orders/:id/receive',
  requireSession,
  requirePermission('procurement.receive'),
  validateOrderIdParam,
  validateReceiveOrder,
  (c) => procurementController.receiveOrder(c, c.req.valid('param').id, c.req.valid('json')),
)

procurementRoutes.get(
  '/api/procurement/returns',
  requireSession,
  requirePermission('procurement.read'),
  validateReturnListQuery,
  (c) => procurementController.listReturns(c, c.req.valid('query')),
)

procurementRoutes.post(
  '/api/procurement/returns',
  requireSession,
  requirePermission('procurement.return'),
  validateReturnCreate,
  (c) => procurementController.createReturn(c, c.req.valid('json')),
)

procurementRoutes.get(
  '/api/procurement/returns/:id',
  requireSession,
  requirePermission('procurement.read'),
  validateOrderIdParam,
  (c) => procurementController.getReturn(c, c.req.valid('param').id),
)

procurementRoutes.post(
  '/api/procurement/returns/:id/post',
  requireSession,
  requirePermission('procurement.return'),
  validateOrderIdParam,
  (c) => procurementController.postReturn(c, c.req.valid('param').id),
)

procurementRoutes.post(
  '/api/procurement/returns/:id/cancel',
  requireSession,
  requirePermission('procurement.return'),
  validateOrderIdParam,
  validateReturnCancel,
  (c) => procurementController.cancelReturn(c, c.req.valid('param').id, c.req.valid('json')),
)
