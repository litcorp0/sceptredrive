import { requirePermission } from '../../http/authorize.ts'
import { factory } from '../../http/factory.ts'
import { requireSession } from '../../http/session.ts'
import * as inventoryController from './inventory.controller.ts'
import {
  validateAdjustmentCreate,
  validateMovementListQuery,
  validateReceiptCreate,
  validateReceiptIdParam,
  validateReceiptListQuery,
  validateStockDetailQuery,
  validateStockListQuery,
  validateStockProductParam,
  validateStockReportQuery,
  validateThresholdDeleteQuery,
  validateThresholdUpdate,
} from './inventory.validation.ts'

export const inventoryRoutes = factory.createApp()

inventoryRoutes.get(
  '/api/inventory/stock',
  requireSession,
  requirePermission('inventory.read'),
  validateStockListQuery,
  (c) => inventoryController.listStock(c, c.req.valid('query')),
)

/**
 * Both report routes are registered **before** `/stock/:productId`, so the literal
 * `report` segment can never be read as a product id.
 */
inventoryRoutes.get(
  '/api/inventory/stock/report',
  requireSession,
  requirePermission('inventory.read'),
  validateStockReportQuery,
  (c) => inventoryController.getStockReport(c, c.req.valid('query')),
)

inventoryRoutes.get(
  '/api/inventory/stock/report/export',
  requireSession,
  requirePermission('inventory.read'),
  validateStockReportQuery,
  (c) => inventoryController.exportStockReport(c, c.req.valid('query')),
)

inventoryRoutes.get(
  '/api/inventory/stock/:productId',
  requireSession,
  requirePermission('inventory.read'),
  validateStockProductParam,
  validateStockDetailQuery,
  (c) =>
    inventoryController.getStockDetail(
      c,
      c.req.valid('param').productId,
      c.req.valid('query').branchId,
    ),
)

inventoryRoutes.get(
  '/api/inventory/low-stock',
  requireSession,
  requirePermission('inventory.read'),
  validateStockListQuery,
  (c) => inventoryController.listLowStock(c, c.req.valid('query')),
)

inventoryRoutes.get(
  '/api/inventory/movements',
  requireSession,
  requirePermission('inventory.read'),
  validateMovementListQuery,
  (c) => inventoryController.listMovements(c, c.req.valid('query')),
)

inventoryRoutes.post(
  '/api/inventory/adjustments',
  requireSession,
  requirePermission('inventory.adjust'),
  validateAdjustmentCreate,
  (c) => inventoryController.createAdjustment(c, c.req.valid('json')),
)

inventoryRoutes.get(
  '/api/inventory/receipts',
  requireSession,
  requirePermission('inventory.read'),
  validateReceiptListQuery,
  (c) => inventoryController.listReceipts(c, c.req.valid('query')),
)

inventoryRoutes.post(
  '/api/inventory/receipts',
  requireSession,
  requirePermission('inventory.receive'),
  validateReceiptCreate,
  (c) => inventoryController.createReceipt(c, c.req.valid('json')),
)

inventoryRoutes.get(
  '/api/inventory/receipts/:id',
  requireSession,
  requirePermission('inventory.read'),
  validateReceiptIdParam,
  (c) => inventoryController.getReceipt(c, c.req.valid('param').id),
)

inventoryRoutes.get(
  '/api/inventory/thresholds',
  requireSession,
  requirePermission('inventory.read'),
  validateStockDetailQuery,
  (c) => inventoryController.listThresholds(c, c.req.valid('query').branchId),
)

inventoryRoutes.put(
  '/api/inventory/thresholds',
  requireSession,
  requirePermission('inventory.threshold'),
  validateThresholdUpdate,
  (c) => inventoryController.setThreshold(c, c.req.valid('json')),
)

inventoryRoutes.delete(
  '/api/inventory/thresholds/:productId',
  requireSession,
  requirePermission('inventory.threshold'),
  validateStockProductParam,
  validateThresholdDeleteQuery,
  (c) =>
    inventoryController.removeThreshold(
      c,
      c.req.valid('param').productId,
      c.req.valid('query').branchId,
    ),
)
