import type { Context } from 'hono'
import { currentUser } from '../../http/authorize.ts'
import type { AppEnv } from '../../http/factory.ts'
import * as auditService from './audit.service.ts'
import type { AuditListQuery } from './audit.types.ts'

export async function listAudit(c: Context<AppEnv>, query: AuditListQuery) {
  const user = currentUser(c)
  const result = await auditService.queryAudit(user, {
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
}
