import { requirePermission } from '../../http/authorize.ts'
import { factory } from '../../http/factory.ts'
import { requireSession } from '../../http/session.ts'
import * as catalogController from './catalog.controller.ts'
import {
  validateBrandCreate,
  validateBrandUpdate,
  validateCatalogIdParam,
  validateCatalogListQuery,
  validateCategoryCreate,
  validateCategoryUpdate,
  validateUomCreate,
  validateUomUpdate,
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

catalogRoutes.get(
  '/api/brands',
  requireSession,
  requirePermission('catalog.read'),
  validateCatalogListQuery,
  (c) => catalogController.listBrands(c, c.req.valid('query')),
)

catalogRoutes.post(
  '/api/brands',
  requireSession,
  requirePermission('catalog.create'),
  validateBrandCreate,
  (c) => catalogController.createBrand(c, c.req.valid('json')),
)

catalogRoutes.patch(
  '/api/brands/:id',
  requireSession,
  requirePermission('catalog.update'),
  validateCatalogIdParam,
  validateBrandUpdate,
  (c) => catalogController.updateBrand(c, c.req.valid('param').id, c.req.valid('json')),
)

catalogRoutes.post(
  '/api/brands/:id/archive',
  requireSession,
  requirePermission('catalog.archive'),
  validateCatalogIdParam,
  (c) => catalogController.archiveBrand(c, c.req.valid('param').id),
)

catalogRoutes.post(
  '/api/brands/:id/reactivate',
  requireSession,
  requirePermission('catalog.archive'),
  validateCatalogIdParam,
  (c) => catalogController.reactivateBrand(c, c.req.valid('param').id),
)

catalogRoutes.get(
  '/api/uoms',
  requireSession,
  requirePermission('catalog.read'),
  validateCatalogListQuery,
  (c) => catalogController.listUoms(c, c.req.valid('query')),
)

catalogRoutes.post(
  '/api/uoms',
  requireSession,
  requirePermission('catalog.create'),
  validateUomCreate,
  (c) => catalogController.createUom(c, c.req.valid('json')),
)

catalogRoutes.patch(
  '/api/uoms/:id',
  requireSession,
  requirePermission('catalog.update'),
  validateCatalogIdParam,
  validateUomUpdate,
  (c) => catalogController.updateUom(c, c.req.valid('param').id, c.req.valid('json')),
)

catalogRoutes.post(
  '/api/uoms/:id/archive',
  requireSession,
  requirePermission('catalog.archive'),
  validateCatalogIdParam,
  (c) => catalogController.archiveUom(c, c.req.valid('param').id),
)

catalogRoutes.post(
  '/api/uoms/:id/reactivate',
  requireSession,
  requirePermission('catalog.archive'),
  validateCatalogIdParam,
  (c) => catalogController.reactivateUom(c, c.req.valid('param').id),
)
