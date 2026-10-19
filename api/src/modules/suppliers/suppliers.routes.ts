import { requirePermission } from '../../http/authorize.ts'
import { factory } from '../../http/factory.ts'
import { requireSession } from '../../http/session.ts'
import * as suppliersController from './suppliers.controller.ts'
import {
  validateSupplierCreate,
  validateSupplierIdParam,
  validateSupplierListQuery,
  validateSupplierNote,
  validateSupplierPaymentDetailCreate,
  validateSupplierPaymentDetailParam,
  validateSupplierPaymentDetailUpdate,
  validateSupplierProductCreate,
  validateSupplierProductParam,
  validateSupplierProductUpdate,
  validateSupplierUpdate,
} from './suppliers.validation.ts'

export const suppliersRoutes = factory.createApp()

suppliersRoutes.get(
  '/api/suppliers',
  requireSession,
  requirePermission('supplier.read'),
  validateSupplierListQuery,
  (c) => suppliersController.listSuppliers(c, c.req.valid('query')),
)

suppliersRoutes.post(
  '/api/suppliers',
  requireSession,
  requirePermission('supplier.create'),
  validateSupplierCreate,
  (c) => suppliersController.createSupplier(c, c.req.valid('json')),
)

suppliersRoutes.get(
  '/api/suppliers/:id',
  requireSession,
  requirePermission('supplier.read'),
  validateSupplierIdParam,
  (c) => suppliersController.getSupplier(c, c.req.valid('param').id),
)

suppliersRoutes.patch(
  '/api/suppliers/:id',
  requireSession,
  requirePermission('supplier.update'),
  validateSupplierIdParam,
  validateSupplierUpdate,
  (c) => suppliersController.updateSupplier(c, c.req.valid('param').id, c.req.valid('json')),
)

suppliersRoutes.post(
  '/api/suppliers/:id/archive',
  requireSession,
  requirePermission('supplier.archive'),
  validateSupplierIdParam,
  validateSupplierNote,
  (c) => suppliersController.archiveSupplier(c, c.req.valid('param').id, c.req.valid('json')),
)

suppliersRoutes.post(
  '/api/suppliers/:id/reactivate',
  requireSession,
  requirePermission('supplier.archive'),
  validateSupplierIdParam,
  (c) => suppliersController.reactivateSupplier(c, c.req.valid('param').id),
)

suppliersRoutes.post(
  '/api/suppliers/:id/payment-details',
  requireSession,
  requirePermission('supplier.update'),
  validateSupplierIdParam,
  validateSupplierPaymentDetailCreate,
  (c) => suppliersController.addPaymentDetail(c, c.req.valid('param').id, c.req.valid('json')),
)

suppliersRoutes.patch(
  '/api/suppliers/:id/payment-details/:detailId',
  requireSession,
  requirePermission('supplier.update'),
  validateSupplierPaymentDetailParam,
  validateSupplierPaymentDetailUpdate,
  (c) =>
    suppliersController.updatePaymentDetail(
      c,
      c.req.valid('param').id,
      c.req.valid('param').detailId,
      c.req.valid('json'),
    ),
)

suppliersRoutes.post(
  '/api/suppliers/:id/products',
  requireSession,
  requirePermission('supplier.update'),
  validateSupplierIdParam,
  validateSupplierProductCreate,
  (c) => suppliersController.addSupplierProduct(c, c.req.valid('param').id, c.req.valid('json')),
)

suppliersRoutes.patch(
  '/api/suppliers/:id/products/:mappingId',
  requireSession,
  requirePermission('supplier.update'),
  validateSupplierProductParam,
  validateSupplierProductUpdate,
  (c) =>
    suppliersController.updateSupplierProduct(
      c,
      c.req.valid('param').id,
      c.req.valid('param').mappingId,
      c.req.valid('json'),
    ),
)

suppliersRoutes.delete(
  '/api/suppliers/:id/products/:mappingId',
  requireSession,
  requirePermission('supplier.update'),
  validateSupplierProductParam,
  (c) =>
    suppliersController.removeSupplierProduct(
      c,
      c.req.valid('param').id,
      c.req.valid('param').mappingId,
    ),
)
