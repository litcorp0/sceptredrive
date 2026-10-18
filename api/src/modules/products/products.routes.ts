import { requirePermission } from '../../http/authorize.ts'
import { factory } from '../../http/factory.ts'
import { requireSession } from '../../http/session.ts'
import * as productsController from './products.controller.ts'
import {
  validateBarcodeCreate,
  validateProductBarcodeParam,
  validateProductCreate,
  validateProductIdParam,
  validateProductUpdate,
} from './products.validation.ts'

export const productsRoutes = factory.createApp()

productsRoutes.get(
  '/api/products/suggest-sku',
  requireSession,
  requirePermission('catalog.create'),
  (c) => productsController.suggestSku(c),
)

productsRoutes.post(
  '/api/products',
  requireSession,
  requirePermission('catalog.create'),
  validateProductCreate,
  (c) => productsController.createProduct(c, c.req.valid('json')),
)

productsRoutes.get(
  '/api/products/:id',
  requireSession,
  requirePermission('catalog.read'),
  validateProductIdParam,
  (c) => productsController.getProduct(c, c.req.valid('param').id),
)

productsRoutes.patch(
  '/api/products/:id',
  requireSession,
  requirePermission('catalog.update'),
  validateProductIdParam,
  validateProductUpdate,
  (c) => productsController.updateProduct(c, c.req.valid('param').id, c.req.valid('json')),
)

productsRoutes.post(
  '/api/products/:id/archive',
  requireSession,
  requirePermission('catalog.archive'),
  validateProductIdParam,
  (c) => productsController.archiveProduct(c, c.req.valid('param').id),
)

productsRoutes.post(
  '/api/products/:id/reactivate',
  requireSession,
  requirePermission('catalog.archive'),
  validateProductIdParam,
  (c) => productsController.reactivateProduct(c, c.req.valid('param').id),
)

productsRoutes.post(
  '/api/products/:id/barcodes',
  requireSession,
  requirePermission('catalog.update'),
  validateProductIdParam,
  validateBarcodeCreate,
  (c) => productsController.addBarcode(c, c.req.valid('param').id, c.req.valid('json')),
)

productsRoutes.delete(
  '/api/products/:id/barcodes/:barcodeId',
  requireSession,
  requirePermission('catalog.update'),
  validateProductBarcodeParam,
  (c) =>
    productsController.removeBarcode(c, c.req.valid('param').id, c.req.valid('param').barcodeId),
)
