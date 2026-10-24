import { type DbExecutor, db } from '@sceptre/db'
import { and, count, desc, eq, gte, lte, type SQL } from 'drizzle-orm'
import { auditLog } from './audit.schema.ts'
import type { AuditEntry, AuditLogRow, AuditQueryFilters } from './audit.types.ts'

export async function insertAuditRow(entry: AuditEntry, executor: DbExecutor = db): Promise<void> {
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

export interface AuditQueryScope extends AuditQueryFilters {
  branchScope: string | null
}

function buildWhere(scope: AuditQueryScope): SQL | undefined {
  const conditions: SQL[] = []
  if (scope.branchScope) conditions.push(eq(auditLog.branchId, scope.branchScope))
  if (scope.actorId) conditions.push(eq(auditLog.actorId, scope.actorId))
  if (scope.actorStaffId) conditions.push(eq(auditLog.actorStaffId, scope.actorStaffId))
  if (scope.action) conditions.push(eq(auditLog.action, scope.action))
  if (scope.entity) conditions.push(eq(auditLog.entity, scope.entity))
  if (scope.entityId) conditions.push(eq(auditLog.entityId, scope.entityId))
  if (scope.from) conditions.push(gte(auditLog.createdAt, scope.from))
  if (scope.to) conditions.push(lte(auditLog.createdAt, scope.to))
  return conditions.length > 0 ? and(...conditions) : undefined
}

export async function selectAuditPage(
  scope: AuditQueryScope,
  executor: DbExecutor = db,
): Promise<AuditLogRow[]> {
  return executor
    .select()
    .from(auditLog)
    .where(buildWhere(scope))
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(scope.limit)
    .offset(scope.offset)
}

export async function countAuditRows(
  scope: AuditQueryScope,
  executor: DbExecutor = db,
): Promise<number> {
  const rows = await executor.select({ value: count() }).from(auditLog).where(buildWhere(scope))
  return rows[0]?.value ?? 0
}
