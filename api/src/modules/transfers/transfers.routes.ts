import { requirePermission } from '../../http/authorize.ts'
import { factory } from '../../http/factory.ts'
import { requireSession } from '../../http/session.ts'
import * as transfersController from './transfers.controller.ts'
import {
  validateDispatch,
  validateReceive,
  validateShortClose,
  validateTransferCreate,
  validateTransferIdParam,
  validateTransferLinesReplace,
  validateTransferListQuery,
  validateTransferUpdate,
} from './transfers.validation.ts'

export const transfersRoutes = factory.createApp()

transfersRoutes.get(
  '/api/transfers',
  requireSession,
  requirePermission('inventory.read'),
  validateTransferListQuery,
  (c) => transfersController.listTransfers(c, c.req.valid('query')),
)

transfersRoutes.post(
  '/api/transfers',
  requireSession,
  requirePermission('inventory.transfer'),
  validateTransferCreate,
  (c) => transfersController.createTransfer(c, c.req.valid('json')),
)

transfersRoutes.get(
  '/api/transfers/:id',
  requireSession,
  requirePermission('inventory.read'),
  validateTransferIdParam,
  (c) => transfersController.getTransfer(c, c.req.valid('param').id),
)

transfersRoutes.patch(
  '/api/transfers/:id',
  requireSession,
  requirePermission('inventory.transfer'),
  validateTransferIdParam,
  validateTransferUpdate,
  (c) => transfersController.updateTransfer(c, c.req.valid('param').id, c.req.valid('json')),
)

transfersRoutes.put(
  '/api/transfers/:id/lines',
  requireSession,
  requirePermission('inventory.transfer'),
  validateTransferIdParam,
  validateTransferLinesReplace,
  (c) => transfersController.replaceTransferLines(c, c.req.valid('param').id, c.req.valid('json')),
)

transfersRoutes.post(
  '/api/transfers/:id/cancel',
  requireSession,
  requirePermission('inventory.transfer'),
  validateTransferIdParam,
  (c) => transfersController.cancelTransfer(c, c.req.valid('param').id),
)

transfersRoutes.post(
  '/api/transfers/:id/dispatch',
  requireSession,
  requirePermission('inventory.transfer'),
  validateTransferIdParam,
  validateDispatch,
  (c) => transfersController.dispatchTransfer(c, c.req.valid('param').id, c.req.valid('json')),
)

transfersRoutes.post(
  '/api/transfers/:id/receive',
  requireSession,
  requirePermission('inventory.transfer'),
  validateTransferIdParam,
  validateReceive,
  (c) => transfersController.receiveTransfer(c, c.req.valid('param').id, c.req.valid('json')),
)

transfersRoutes.post(
  '/api/transfers/:id/short-close',
  requireSession,
  requirePermission('inventory.transfer'),
  validateTransferIdParam,
  validateShortClose,
  (c) => transfersController.shortCloseTransfer(c, c.req.valid('param').id, c.req.valid('json')),
)
