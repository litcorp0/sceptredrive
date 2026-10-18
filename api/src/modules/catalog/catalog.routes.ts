import { requirePermission } from '../../http/authorize.ts'
import { factory } from '../../http/factory.ts'
import { requireSession } from '../../http/session.ts'
import * as catalogController from './catalog.controller.ts'
import {
  validateCatalogIdParam,
  validateCatalogListQuery,
  validateCategoryCreate,
  validateCategoryUpdate,
} from './catalog.validation.ts'

export const catalogRoutes = factory.createApp()

catalogRoutes.get(
  '/api/categories',
  requireSession,
  requirePermission('catalog.read'),
  validateCatalogListQuery,
  (c) => catalogController.listCategories(c, c.req.valid('query')),
)

catalogRoutes.post(
  '/api/categories',
  requireSession,
  requirePermission('catalog.create'),
  validateCategoryCreate,
  (c) => catalogController.createCategory(c, c.req.valid('json')),
)

catalogRoutes.patch(
  '/api/categories/:id',
  requireSession,
  requirePermission('catalog.update'),
  validateCatalogIdParam,
  validateCategoryUpdate,
  (c) => catalogController.updateCategory(c, c.req.valid('param').id, c.req.valid('json')),
)

catalogRoutes.post(
  '/api/categories/:id/archive',
  requireSession,
  requirePermission('catalog.archive'),
  validateCatalogIdParam,
  (c) => catalogController.archiveCategory(c, c.req.valid('param').id),
)

catalogRoutes.post(
  '/api/categories/:id/reactivate',
  requireSession,
  requirePermission('catalog.archive'),
  validateCatalogIdParam,
  (c) => catalogController.reactivateCategory(c, c.req.valid('param').id),
)
