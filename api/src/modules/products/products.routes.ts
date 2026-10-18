import { requirePermission } from '../../http/authorize.ts'
import { factory } from '../../http/factory.ts'
import { requireSession } from '../../http/session.ts'
import * as productsController from './products.controller.ts'
import { validateProductCreate } from './products.validation.ts'

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
