import { type DbExecutor, db } from '@sceptre/db'
import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from 'drizzle-orm'
import { branch } from '../org/branches.schema.ts'
import { refund, refundLine, refundTender, sale, saleLine, saleTender } from '../pos/pos.schema.ts'
import { product } from '../products/products.schema.ts'
import { evatSubmission } from './evat.schema.ts'
import type {
  EvatListFilters,
  EvatSubmissionJoinedRow,
  EvatSubmissionRow,
  EvatSummaryCounts,
} from './evat.types.ts'

/**
 * Drizzle only: no state machine, no deadline arithmetic, no settings.
 *
 * The owner of `evat_submission` is this module, so the reads here stand alone.
 * Reading a sale or a refund to *build a document* is a join to the sibling
 * schema files, not a second copy of their business rules.
 */

export type SaleDocumentRow = typeof sale.$inferSelect
export type SaleLineDocumentRow = typeof saleLine.$inferSelect
export type SaleTenderDocumentRow = typeof saleTender.$inferSelect
export type RefundDocumentRow = typeof refund.$inferSelect
export type RefundTenderDocumentRow = typeof refundTender.$inferSelect

export interface RefundLineDocumentRow {
  lineNumber: number
  quantity: number
  unitPriceMinor: number
  lineTotalMinor: number
  productName: string
  productSku: string
  taxCategory: string
}

export async function findSaleDocument(
  saleId: string,
  executor: DbExecutor = db,
): Promise<SaleDocumentRow | null> {
  const rows = await executor.select().from(sale).where(eq(sale.id, saleId)).limit(1)
  return rows[0] ?? null
}

export async function selectSaleDocumentLines(
  saleId: string,
  executor: DbExecutor = db,
): Promise<SaleLineDocumentRow[]> {
  return executor
    .select()
    .from(saleLine)
    .where(eq(saleLine.saleId, saleId))
    .orderBy(asc(saleLine.lineNumber))
}

export async function selectSaleDocumentTenders(
  saleId: string,
  executor: DbExecutor = db,
): Promise<SaleTenderDocumentRow[]> {
  return executor
    .select()
    .from(saleTender)
    .where(eq(saleTender.saleId, saleId))
    .orderBy(asc(saleTender.sequence))
}

export async function findRefundDocument(
  refundId: string,
  executor: DbExecutor = db,
): Promise<RefundDocumentRow | null> {
  const rows = await executor.select().from(refund).where(eq(refund.id, refundId)).limit(1)
  return rows[0] ?? null
}

export async function selectRefundDocumentLines(
  refundId: string,
  executor: DbExecutor = db,
): Promise<RefundLineDocumentRow[]> {
  return executor
    .select({
      lineNumber: refundLine.lineNumber,
      quantity: refundLine.quantity,
      unitPriceMinor: refundLine.unitPriceMinor,
      lineTotalMinor: refundLine.totalMinor,
      productName: product.name,
      productSku: product.sku,
      taxCategory: saleLine.taxCategory,
    })
    .from(refundLine)
    .innerJoin(saleLine, eq(saleLine.id, refundLine.saleLineId))
    .innerJoin(product, eq(product.id, refundLine.productId))
    .where(eq(refundLine.refundId, refundId))
    .orderBy(asc(refundLine.lineNumber))
}

export async function selectRefundDocumentTenders(
  refundId: string,
  executor: DbExecutor = db,
): Promise<RefundTenderDocumentRow[]> {
  return executor
    .select()
    .from(refundTender)
    .where(eq(refundTender.refundId, refundId))
    .orderBy(asc(refundTender.sequence))
}

export async function findBranchForDocument(
  branchId: string,
  executor: DbExecutor = db,
): Promise<typeof branch.$inferSelect | null> {
  const rows = await executor.select().from(branch).where(eq(branch.id, branchId)).limit(1)
  return rows[0] ?? null
}

/**
 * One row per document. `ON CONFLICT DO NOTHING` with no target is deliberate:
 * the uniqueness is enforced by two *partial* indexes, and PostgreSQL will only
 * infer a partial index when the predicate is repeated or no target is named.
 * "No target" also makes the insert safe against a concurrent duplicate of the
 * other kind, which is exactly what a replayed upload looks like.
 */
export async function insertQueuedSubmission(
  values: typeof evatSubmission.$inferInsert,
  executor: DbExecutor,
): Promise<EvatSubmissionRow | null> {
  const rows = await executor
    .insert(evatSubmission)
    .values(values)
    .onConflictDoNothing()
    .returning()
  return rows[0] ?? null
}

export async function findSubmissionBySaleId(
  saleId: string,
  executor: DbExecutor = db,
): Promise<EvatSubmissionRow | null> {
  const rows = await executor
    .select()
    .from(evatSubmission)
    .where(eq(evatSubmission.saleId, saleId))
    .limit(1)
  return rows[0] ?? null
}

export async function findSubmissionByRefundId(
  refundId: string,
  executor: DbExecutor = db,
): Promise<EvatSubmissionRow | null> {
  const rows = await executor
    .select()
    .from(evatSubmission)
    .where(eq(evatSubmission.refundId, refundId))
    .limit(1)
  return rows[0] ?? null
}

export async function findSubmissionRowById(
  id: string,
  executor: DbExecutor = db,
): Promise<EvatSubmissionRow | null> {
  const rows = await executor
    .select()
    .from(evatSubmission)
    .where(eq(evatSubmission.id, id))
    .limit(1)
  return rows[0] ?? null
}

/** The row lock the state machine reads under: two workers never submit twice. */
export async function findSubmissionRowByIdForUpdate(
  id: string,
  executor: DbExecutor,
): Promise<EvatSubmissionRow | null> {
  const rows = await executor
    .select()
    .from(evatSubmission)
    .where(eq(evatSubmission.id, id))
    .limit(1)
    .for('update')
  return rows[0] ?? null
}

export async function updateSubmission(
  id: string,
  patch: Partial<typeof evatSubmission.$inferInsert>,
  executor: DbExecutor,
): Promise<EvatSubmissionRow | null> {
  const rows = await executor
    .update(evatSubmission)
    .set(patch)
    .where(eq(evatSubmission.id, id))
    .returning()
  return rows[0] ?? null
}

const DOCUMENT_NUMBER = sql<string | null>`coalesce(${sale.receiptNumber}, ${refund.number})`

function joinedColumns() {
  return { ...getTableColumns(evatSubmission), documentNumber: DOCUMENT_NUMBER }
}

export async function findSubmissionJoinedById(
  id: string,
  executor: DbExecutor = db,
): Promise<EvatSubmissionJoinedRow | null> {
  const rows = await executor
    .select(joinedColumns())
    .from(evatSubmission)
    .leftJoin(sale, eq(sale.id, evatSubmission.saleId))
    .leftJoin(refund, eq(refund.id, evatSubmission.refundId))
    .where(eq(evatSubmission.id, id))
    .limit(1)
  return rows[0] ?? null
}

function listWhere(filters: EvatListFilters) {
  const clauses = []
  if (filters.branchId) clauses.push(eq(evatSubmission.branchId, filters.branchId))
  if (filters.status) clauses.push(eq(evatSubmission.status, filters.status))
  if (filters.kind) clauses.push(eq(evatSubmission.kind, filters.kind))
  if (filters.overdue === true) {
    clauses.push(and(lt(evatSubmission.dueAt, filters.now), ne(evatSubmission.status, 'CERTIFIED')))
  }
  if (filters.overdue === false) {
    clauses.push(or(gte(evatSubmission.dueAt, filters.now), eq(evatSubmission.status, 'CERTIFIED')))
  }
  if (filters.from) clauses.push(gte(evatSubmission.dueAt, filters.from))
  if (filters.to) clauses.push(lte(evatSubmission.dueAt, filters.to))
  return clauses.length > 0 ? and(...clauses) : undefined
}

export async function selectSubmissionPage(
  filters: EvatListFilters,
): Promise<EvatSubmissionJoinedRow[]> {
  return db
    .select(joinedColumns())
    .from(evatSubmission)
    .leftJoin(sale, eq(sale.id, evatSubmission.saleId))
    .leftJoin(refund, eq(refund.id, evatSubmission.refundId))
    .where(listWhere(filters))
    .orderBy(desc(evatSubmission.createdAt), desc(evatSubmission.id))
    .limit(filters.limit)
    .offset(filters.offset)
}

export async function countSubmissions(filters: EvatListFilters): Promise<number> {
  const rows = await db.select({ total: count() }).from(evatSubmission).where(listWhere(filters))
  return rows[0]?.total ?? 0
}

/**
 * The summary in one pass. `oldestOverdueMinutes` is computed from the earliest
 * missed deadline so the console can say "3 days late" without a second query.
 */
export async function selectSubmissionSummary(branchId: string | null): Promise<EvatSummaryCounts> {
  const rows = await db
    .select({
      queued: sql<string>`count(*) filter (where ${evatSubmission.status} = 'QUEUED')::text`,
      certified: sql<string>`count(*) filter (where ${evatSubmission.status} = 'CERTIFIED')::text`,
      retrying: sql<string>`count(*) filter (where ${evatSubmission.status} = 'RETRY')::text`,
      attention: sql<string>`count(*) filter (where ${evatSubmission.status} = 'ATTENTION')::text`,
      overdue: sql<string>`count(*) filter (where ${evatSubmission.dueAt} < now() and ${evatSubmission.status} <> 'CERTIFIED')::text`,
      oldestDueAt: sql<Date | null>`min(${evatSubmission.dueAt}) filter (where ${evatSubmission.dueAt} < now() and ${evatSubmission.status} <> 'CERTIFIED')`,
    })
    .from(evatSubmission)
    .where(branchId ? eq(evatSubmission.branchId, branchId) : undefined)

  const row = rows[0]
  return {
    queued: Number(row?.queued ?? 0),
    certified: Number(row?.certified ?? 0),
    retrying: Number(row?.retrying ?? 0),
    attention: Number(row?.attention ?? 0),
    overdue: Number(row?.overdue ?? 0),
    oldestDueAt: row?.oldestDueAt ? new Date(row.oldestDueAt) : null,
  }
}

/**
 * The worker's claim: due rows only, soonest first. A `RETRY` whose ladder has
 * not elapsed is not due; a `QUEUED` row has no `next_attempt_at` and sorts
 * first because it has never been tried.
 */
export async function selectDueSubmissions(
  now: Date,
  limit: number,
  executor: DbExecutor = db,
): Promise<EvatSubmissionRow[]> {
  return executor
    .select()
    .from(evatSubmission)
    .where(
      and(
        inArray(evatSubmission.status, ['QUEUED', 'RETRY']),
        or(isNull(evatSubmission.nextAttemptAt), lte(evatSubmission.nextAttemptAt, now)),
      ),
    )
    .orderBy(sql`${evatSubmission.nextAttemptAt} asc nulls first`, asc(evatSubmission.createdAt))
    .limit(limit)
}

/**
 * A refund waits for its invoice (P14-D37). Promoting is a status move, not a
 * new row: the deadline stays the refund's own `due_at`.
 */
export async function promoteWaitingRefundsForSale(
  saleId: string,
  executor: DbExecutor,
): Promise<number> {
  const result = await executor.execute<{ id: string }>(sql`
    UPDATE evat_submission AS waiting
    SET status = 'QUEUED', next_attempt_at = NULL, updated_at = now()
    FROM refund
    WHERE waiting.kind = 'REFUND'
      AND waiting.status = 'WAITING_FOR_INVOICE'
      AND waiting.refund_id = refund.id
      AND refund.sale_id = ${saleId}
    RETURNING waiting.id
  `)
  return result.rows.length
}

/** The sweep's version: every waiting refund whose invoice has certified since. */
export async function promoteAllWaitingRefunds(executor: DbExecutor): Promise<number> {
  const result = await executor.execute<{ id: string }>(sql`
    UPDATE evat_submission AS waiting
    SET status = 'QUEUED', next_attempt_at = NULL, updated_at = now()
    WHERE waiting.kind = 'REFUND'
      AND waiting.status = 'WAITING_FOR_INVOICE'
      AND EXISTS (
        SELECT 1
        FROM refund
        JOIN evat_submission AS invoice
          ON invoice.sale_id = refund.sale_id
         AND invoice.kind = 'INVOICE'
         AND invoice.status = 'CERTIFIED'
        WHERE refund.id = waiting.refund_id
      )
    RETURNING waiting.id
  `)
  return result.rows.length
}
