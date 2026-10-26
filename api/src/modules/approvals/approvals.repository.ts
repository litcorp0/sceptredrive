import { type DbExecutor, db } from '@sceptre/db'
import type { ApprovalType } from '@sceptre/shared'
import { and, asc, count, desc, eq, or, type SQL, sql } from 'drizzle-orm'
import { approval } from './approvals.schema.ts'
import type { ApprovalListFilters } from './approvals.types.ts'

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

/**
 * One page of the inbox. `oldest` is the queue the manager works through; `id`
 * breaks ties so a page boundary cannot show or skip a row when two requests
 * share a timestamp.
 */
export async function selectApprovalPage(
  filters: ApprovalListFilters,
  executor: DbExecutor = db,
): Promise<(typeof approval.$inferSelect)[]> {
  const direction = filters.sort === 'newest' ? desc : asc
  return executor
    .select()
    .from(approval)
    .where(buildConditions(filters))
    .orderBy(direction(approval.requestedAt), direction(approval.id))
    .limit(filters.limit)
    .offset(filters.offset)
}

export async function countApprovals(
  filters: ApprovalListFilters,
  executor: DbExecutor = db,
): Promise<number> {
  const rows = await executor
    .select({ total: count() })
    .from(approval)
    .where(buildConditions(filters))
  return Number(rows[0]?.total ?? 0)
}

/**
 * Pending rows grouped by type, for the nav badge and the manager's view.
 *
 * The branch predicate is the same one the inbox uses for a scoped manager
 * (`branch_id = X OR decider_branch_id = X`): a badge that undercounts the queue
 * it badges is worse than no badge.
 */
export async function countPendingByType(
  scope: { branchId: string } | null,
  executor: DbExecutor = db,
): Promise<Array<{ type: ApprovalType; count: number }>> {
  const conditions = [eq(approval.status, 'PENDING')]
  if (scope) conditions.push(branchPredicate(scope.branchId, true))

  const rows = await executor
    .select({ type: approval.type, total: count() })
    .from(approval)
    .where(and(...conditions))
    .groupBy(approval.type)

  return rows.map((row) => ({ type: row.type, count: Number(row.total) }))
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

function buildConditions(filters: ApprovalListFilters) {
  const conditions = []
  if (filters.type) conditions.push(eq(approval.type, filters.type))
  if (filters.status) conditions.push(eq(approval.status, filters.status))
  if (filters.entityId) conditions.push(eq(approval.entityId, filters.entityId))
  if (filters.scope) {
    conditions.push(branchPredicate(filters.scope.branchId, filters.includeDeciderBranch))
  }
  if (conditions.length === 0) return sql`true`
  return and(...conditions)
}

/** `branch_id = X`, or both sides of the request when the caller must decide it. */
function branchPredicate(branchId: string, includeDeciderBranch: boolean): SQL<unknown> {
  if (!includeDeciderBranch) return eq(approval.branchId, branchId)
  return or(eq(approval.branchId, branchId), eq(approval.deciderBranchId, branchId)) ?? sql`false`
}
