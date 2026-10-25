import { type DbExecutor, db } from '@sceptre/db'
import { and, count, desc, eq, sql } from 'drizzle-orm'
import { approval } from './approvals.schema.ts'
import type { ApprovalListQuery } from './approvals.types.ts'

/**
 * Data access for the approval entity. No decisions are made here.
 */

export async function insertApproval(
  values: typeof approval.$inferInsert,
  executor: DbExecutor,
): Promise<typeof approval.$inferSelect> {
  const rows = await executor.insert(approval).values(values).returning()
  const row = rows[0]
  if (!row) throw new Error('Failed to insert approval')
  return row
}

export async function findApprovalById(
  id: string,
  executor: DbExecutor = db,
): Promise<typeof approval.$inferSelect | null> {
  const rows = await executor.select().from(approval).where(eq(approval.id, id)).limit(1)
  return rows[0] ?? null
}

export async function lockApprovalForUpdate(
  id: string,
  executor: DbExecutor,
): Promise<typeof approval.$inferSelect | null> {
  const rows = await executor.select().from(approval).where(eq(approval.id, id)).for('update')
  return rows[0] ?? null
}

export async function findPendingApprovalForEntity(
  type: (typeof approval.$inferInsert)['type'],
  entityId: string,
  executor: DbExecutor = db,
): Promise<typeof approval.$inferSelect | null> {
  const rows = await executor
    .select()
    .from(approval)
    .where(
      and(eq(approval.type, type), eq(approval.entityId, entityId), eq(approval.status, 'PENDING')),
    )
    .limit(1)
  return rows[0] ?? null
}

export async function selectApprovalPage(
  filters: ApprovalListQuery,
  executor: DbExecutor = db,
): Promise<(typeof approval.$inferSelect)[]> {
  const conditions = buildConditions(filters)
  return executor
    .select()
    .from(approval)
    .where(conditions)
    .orderBy(desc(approval.requestedAt))
    .limit(filters.limit)
    .offset(filters.offset)
}

export async function countApprovals(
  filters: ApprovalListQuery,
  executor: DbExecutor = db,
): Promise<number> {
  const rows = await executor
    .select({ total: count() })
    .from(approval)
    .where(buildConditions(filters))
  return Number(rows[0]?.total ?? 0)
}

export async function updateApprovalDecision(
  id: string,
  patch: {
    status: 'APPROVED' | 'REJECTED'
    decidedBy: string
    decidedAt: Date
    decisionReasonCode: (typeof approval.$inferInsert)['decisionReasonCode']
    decisionNote: string | null
  },
  executor: DbExecutor,
): Promise<typeof approval.$inferSelect | null> {
  const rows = await executor.update(approval).set(patch).where(eq(approval.id, id)).returning()
  return rows[0] ?? null
}

export async function withdrawApprovalRow(
  id: string,
  executor: DbExecutor,
): Promise<typeof approval.$inferSelect | null> {
  const rows = await executor
    .update(approval)
    .set({ status: 'WITHDRAWN' })
    .where(eq(approval.id, id))
    .returning()
  return rows[0] ?? null
}

export async function pointApprovalAtEntity(
  id: string,
  entityId: string,
  executor: DbExecutor,
): Promise<void> {
  await executor.update(approval).set({ entityId }).where(eq(approval.id, id))
}

function buildConditions(filters: ApprovalListQuery) {
  const conditions = []
  if (filters.type) conditions.push(eq(approval.type, filters.type))
  if (filters.status) conditions.push(eq(approval.status, filters.status))
  if (filters.branchId) conditions.push(eq(approval.branchId, filters.branchId))
  if (conditions.length === 0) return sql`true`
  return and(...conditions)
}
