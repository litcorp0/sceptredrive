import { requirePermission } from '../../http/authorize.ts'
import { factory } from '../../http/factory.ts'
import { requireSession } from '../../http/session.ts'
import * as openingsController from './openings.controller.ts'
import {
  validateOpeningCreate,
  validateOpeningIdParam,
  validateOpeningListQuery,
  validateOpeningPost,
  validateOpeningPreview,
} from './openings.validation.ts'

export const openingsRoutes = factory.createApp()

/**
 * The preview is a write-shaped read: it validates a file and returns the rows.
 * It needs the draft permission because it resolves catalogue references and
 * quotes the stock the operator is about to add.
 */
openingsRoutes.post(
  '/api/openings/preview',
  requireSession,
  requirePermission('inventory.opening.draft'),
  validateOpeningPreview,
  (c) => openingsController.previewOpening(c, c.req.valid('json')),
)

openingsRoutes.post(
  '/api/openings',
  requireSession,
  requirePermission('inventory.opening.draft'),
  validateOpeningCreate,
  (c) => openingsController.createOpening(c, c.req.valid('json')),
)

openingsRoutes.get(
  '/api/openings',
  requireSession,
  requirePermission('inventory.read'),
  validateOpeningListQuery,
  (c) => openingsController.listOpenings(c, c.req.valid('query')),
)

openingsRoutes.get(
  '/api/openings/:id',
  requireSession,
  requirePermission('inventory.read'),
  validateOpeningIdParam,
  (c) => openingsController.getOpening(c, c.req.valid('param').id),
)

openingsRoutes.delete(
  '/api/openings/:id',
  requireSession,
  requirePermission('inventory.opening.draft'),
  validateOpeningIdParam,
  (c) => openingsController.deleteOpening(c, c.req.valid('param').id),
)

/** Only an admin holds `inventory.opening.post`; the service checks the role again. */
openingsRoutes.post(
  '/api/openings/:id/post',
  requireSession,
  requirePermission('inventory.opening.post'),
  validateOpeningIdParam,
  validateOpeningPost,
  (c) => openingsController.postOpening(c, c.req.valid('param').id, c.req.valid('json')),
)
