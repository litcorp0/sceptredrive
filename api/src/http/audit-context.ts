import type { Context } from 'hono'
import type { AuditActor } from '../modules/platform/audit.types.ts'
import type { AppEnv } from './factory.ts'
import { clientIpFromHeaders } from './request-meta.ts'

/** Human-readable actor label for documents (staff id preferred over user id). */
export function actorLabel(actor: AuditActor): string | null {
  return actor.actorStaffId ?? actor.actorId
}

/** Adapts the request context into the audit actor fields. */
export function actorFromContext(c: Context<AppEnv>): AuditActor {
  const user = c.get('user')
  return {
    actorId: user?.id ?? null,
    actorStaffId: user?.staffId ?? null,
    ip: clientIpFromHeaders(c.req.raw.headers),
    userAgent: c.req.header('user-agent') ?? null,
    requestId: c.get('requestId'),
  }
}
