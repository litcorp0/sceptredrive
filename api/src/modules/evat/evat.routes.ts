import { requirePermission } from '../../http/authorize.ts'
import { factory } from '../../http/factory.ts'
import { requireSession } from '../../http/session.ts'
import * as evatController from './evat.controller.ts'
import { validateEvatIdParam, validateEvatListQuery } from './evat.validation.ts'

/**
 * The E-VAT console surface (P14-D40). Reads and the health probe are open to
 * anyone holding `evat.read` — a manager sees their own branch — while a
 * retry is `evat.retry`, which only an admin holds: a failed GRA submission is
 * a compliance matter, not a branch one.
 */
export const evatRoutes = factory.createApp()

evatRoutes.get(
  '/api/evat/submissions',
  requireSession,
  requirePermission('evat.read'),
  validateEvatListQuery,
  (c) => evatController.listSubmissions(c, c.req.valid('query')),
)

evatRoutes.get('/api/evat/summary', requireSession, requirePermission('evat.read'), (c) =>
  evatController.getSummary(c),
)

// The provider probe is a network call; the service caches it for a minute.
evatRoutes.get('/api/evat/health', requireSession, requirePermission('evat.read'), (c) =>
  evatController.getHealth(c),
)

evatRoutes.get(
  '/api/evat/submissions/:id',
  requireSession,
  requirePermission('evat.read'),
  validateEvatIdParam,
  (c) => evatController.getSubmission(c, c.req.valid('param').id),
)

evatRoutes.post(
  '/api/evat/submissions/:id/retry',
  requireSession,
  requirePermission('evat.retry'),
  validateEvatIdParam,
  (c) => evatController.retrySubmission(c, c.req.valid('param').id),
)
