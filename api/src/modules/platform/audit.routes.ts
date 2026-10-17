import { z } from 'zod'
import { currentUser, requirePermission } from '../../http/authorize.ts'
import { factory } from '../../http/factory.ts'
import { requireSession } from '../../http/session.ts'
import { validateQuery } from '../../http/validation.ts'
import { queryAudit } from './audit.service.ts'

const listQuerySchema = z.object({
  actorId: z.string().trim().min(1).max(64).optional(),
  action: z.string().trim().min(1).max(120).optional(),
  entity: z.string().trim().min(1).max(64).optional(),
  entityId: z.string().trim().min(1).max(64).optional(),
  branchId: z.uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

export const auditRoutes = factory.createApp()

auditRoutes.get(
  '/api/audit',
  requireSession,
  requirePermission('audit.read'),
  validateQuery(listQuerySchema),
  async (c) => {
    const user = currentUser(c)
    const query = c.req.valid('query')
    const result = await queryAudit(user, {
      actorId: query.actorId,
      action: query.action,
      entity: query.entity,
      entityId: query.entityId,
      branchId: query.branchId,
      from: query.from,
      to: query.to,
      limit: query.limit,
      offset: query.offset,
    })
    return c.json(result)
  },
)
