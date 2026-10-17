import { db, type DbExecutor } from '@gikautos/db'
import { auditLog } from '@gikautos/db/schema'
import { and, count, desc, eq, gte, lte, type SQL } from 'drizzle-orm'
import type { Context } from 'hono'
import { resolveBranchFilter } from '../../auth/scope.ts'
import type { AppEnv, SessionUser } from '../../http/factory.ts'
import { clientIpFromHeaders } from '../../http/request-meta.ts'

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

export interface AuditQueryFilters {
  actorId?: string | undefined
  action?: string | undefined
  entity?: string | undefined
  entityId?: string | undefined
  branchId?: string | undefined
  from?: Date | undefined
  to?: Date | undefined
  limit: number
  offset: number
}

export interface AuditQueryResult {
  entries: (typeof auditLog.$inferSelect)[]
  total: number
}

/** Reads the audit log with manager branch scoping; the log stays append-only. */
export async function queryAudit(
  user: SessionUser,
  filters: AuditQueryFilters,
): Promise<AuditQueryResult> {
  const scope = resolveBranchFilter(user, filters.branchId ?? null)

  const conditions: SQL[] = []
  if (scope) conditions.push(eq(auditLog.branchId, scope))
  if (filters.actorId) conditions.push(eq(auditLog.actorId, filters.actorId))
  if (filters.action) conditions.push(eq(auditLog.action, filters.action))
  if (filters.entity) conditions.push(eq(auditLog.entity, filters.entity))
  if (filters.entityId) conditions.push(eq(auditLog.entityId, filters.entityId))
  if (filters.from) conditions.push(gte(auditLog.createdAt, filters.from))
  if (filters.to) conditions.push(lte(auditLog.createdAt, filters.to))

  const where = conditions.length > 0 ? and(...conditions) : undefined

  const entries = await db
    .select()
    .from(auditLog)
    .where(where)
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(filters.limit)
    .offset(filters.offset)

  const totalRows = await db.select({ value: count() }).from(auditLog).where(where)

  return { entries, total: totalRows[0]?.value ?? 0 }
}
