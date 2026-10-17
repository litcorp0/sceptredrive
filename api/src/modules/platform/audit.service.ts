import { type Database, db } from '@gikautos/db'
import { auditLog } from '@gikautos/db/schema'
import type { Context } from 'hono'
import type { AppEnv } from '../../http/factory.ts'
import { clientIpFromHeaders } from '../../http/request-meta.ts'

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]

/** A pooled connection or an open transaction; audit writes share the caller's transaction. */
export type DbExecutor = Database | Transaction

/** Identity and request metadata attached to every audit row. */
export interface AuditActor {
  actorId: string | null
  actorStaffId: string | null
  ip: string | null
  userAgent: string | null
  requestId: string | null
}

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

export interface AuditEntry {
  action: string
  entity: string
  actorId?: string | null
  actorStaffId?: string | null
  entityId?: string | null
  before?: unknown
  after?: unknown
  branchId?: string | null
  terminalId?: string | null
  ip?: string | null
  userAgent?: string | null
  requestId?: string | null
}

/**
 * Appends a row to the audit log. The audit log is append-only by design:
 * there are no update or delete helpers, and corrections are new entries.
 */
export async function writeAudit(entry: AuditEntry, executor: DbExecutor = db): Promise<void> {
  await executor.insert(auditLog).values({
    actorId: entry.actorId ?? null,
    actorStaffId: entry.actorStaffId ?? null,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    branchId: entry.branchId ?? null,
    terminalId: entry.terminalId ?? null,
    ip: entry.ip ?? null,
    userAgent: entry.userAgent ?? null,
    requestId: entry.requestId ?? null,
  })
}
