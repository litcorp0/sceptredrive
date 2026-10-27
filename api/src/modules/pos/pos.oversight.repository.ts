/**
 * Oversight data access (Phase 14, Plan 03).
 *
 * Reads only. There is no insert, update or delete in this file, by design: an
 * oversight screen records a document, it never corrects one (P14-D13, README
 * "the three things this phase must not do").
 *
 * Two rules shape every statement here:
 *
 * - **The row that owns a figure supplies it.** A receipt copy prints
 *   `sale.total_minor`, not a sum of its lines; `refundedMinor` is a correlated
 *   sub-select in the same statement, because a list that shows a fully refunded
 *   sale as a sale is a list a manager will trust wrongly (Plan 03 §3).
 * - **Every filter has an index.** `sale_branch_occurred_idx`,
 *   `refund_branch_occurred_idx`, `shift_branch_opened_idx`,
 *   `sale_receipt_number_unique`, `sale_line_sale_idx`, `refund_sale_idx`. No
 *   migration accompanies this plan, and nothing here needs one.
 *
 * Money is integer minor units end to end. `SUM(...)::bigint` is converted with
 * `toInt` because node-postgres hands bigint back as a string, and a float sum
 * would round a pesewa somewhere a drawer can see.
 */
import type { DbExecutor } from '@sceptre/db'
import { CART_VOID_REASON_LABELS, type RefundReason, type TenderMethod } from '@sceptre/shared'
import { and, asc, desc, eq, type SQL, sql } from 'drizzle-orm'
import { customer } from '../customers/customers.schema.ts'
import { evatSubmission } from '../evat/evat.schema.ts'
import { user as userTable } from '../identity/staff.schema.ts'
import { branch } from '../org/branches.schema.ts'
import { terminal } from '../org/terminals.schema.ts'
import { cartVoid, refund, refundLine, sale, saleLine, saleTender, shift } from './pos.schema.ts'
import type {
  OversightRefundLine,
  OversightRefundRow,
  OversightRefundTender,
  OversightSaleConflictRef,
  OversightSaleLine,
  OversightSaleRefundRef,
  OversightSaleRow,
  OversightSaleTender,
  OversightShiftRow,
  OversightVoidRow,
  ReceiptEvatBlock,
} from './pos.types.ts'

function toInt(value: unknown): number {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : Math.round(value)
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return Math.round(parsed)
  }
  return 0
}

function toOptionalInt(value: unknown): number | null {
  if (value === null || value === undefined) return null
  return toInt(value)
}

/**
 * A timestamp straight from the driver, so every ISO string in an oversight
 * payload is the same instant the row holds — no `to_char`, no format to drift.
 */
function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
  }
  throw new Error('An oversight read received a timestamp it cannot format')
}

function toBoolean(value: unknown): boolean {
  return value === true || value === 't' || value === 'true'
}

/** `sql.join` of the fragments that apply; `true` when a caller filtered nothing. */
function conjunction(fragments: Array<SQL | null>): SQL {
  const present = fragments.filter((fragment): fragment is SQL => fragment !== null)
  if (present.length === 0) return sql`true`
  return sql.join(present, sql` AND `)
}

function branchClause(column: SQL, branchId: string | null): SQL | null {
  return branchId === null ? null : sql`${column} = ${branchId}`
}

/** Half-open day window on an Accra day boundary, so the index stays usable. */
function windowClause(column: SQL, from: Date | null, toExclusive: Date | null): SQL | null {
  const parts: SQL[] = []
  if (from) parts.push(sql`${column} >= ${from}`)
  if (toExclusive) parts.push(sql`${column} < ${toExclusive}`)
  if (parts.length === 0) return null
  return sql.join(parts, sql` AND `)
}

// --- Sales ------------------------------------------------------------------

export interface SaleFilters {
  branchId: string | null
  from: Date | null
  toExclusive: Date | null
  terminalId: string | null
  cashierStaffId: string | null
  /** Exact and case-sensitive: a receipt number is a document key, not a query. */
  receiptNumber: string | null
  limit: number
  offset: number
}

function saleConditions(filters: SaleFilters): SQL {
  return conjunction([
    branchClause(sql`s.branch_id`, filters.branchId),
    windowClause(sql`s.occurred_at`, filters.from, filters.toExclusive),
    filters.terminalId === null ? null : sql`s.terminal_id = ${filters.terminalId}`,
    filters.cashierStaffId === null ? null : sql`s.cashier_staff_id = ${filters.cashierStaffId}`,
    filters.receiptNumber === null ? null : sql`s.receipt_number = ${filters.receiptNumber}`,
  ])
}

/**
 * The sale list row. `items_sold`, `refunded_minor` and the attention count are
 * correlated sub-selects under two indexes apiece (`sale_line_sale_idx`,
 * `refund_sale_idx`): one statement, one snapshot, and a page of 20 rows costs 20
 * index lookups rather than 20 round trips.
 */
const SALE_ROW_SELECT = sql`
  SELECT
    s.id,
    s.receipt_number,
    s.occurred_at,
    s.branch_id,
    s.shift_id,
    b.code AS branch_code,
    b.name AS branch_name,
    t.code AS terminal_code,
    COALESCE(u.name, s.cashier_staff_id) AS cashier_name,
    c.name AS customer_name,
    COALESCE((SELECT SUM(l.quantity) FROM sale_line l WHERE l.sale_id = s.id), 0)::bigint
      AS items_sold,
    s.total_minor,
    s.tax_total_minor,
    s.change_minor,
    s.credit_amount_minor,
    s.conflict_count,
    COALESCE((SELECT SUM(r.refunded_minor) FROM refund r WHERE r.sale_id = s.id), 0)::bigint
      AS refunded_minor
  FROM sale s
  JOIN branch b ON b.id = s.branch_id
  JOIN terminal t ON t.id = s.terminal_id
  LEFT JOIN "user" u ON u.id = s.cashier_user_id
  LEFT JOIN customer c ON c.id = s.customer_id
`

function toSaleRow(row: Record<string, unknown>): OversightSaleRow {
  return {
    id: String(row.id),
    receiptNumber: String(row.receipt_number),
    occurredAt: toIso(row.occurred_at),
    branchId: String(row.branch_id),
    branchCode: String(row.branch_code),
    branchName: String(row.branch_name),
    terminalCode: String(row.terminal_code),
    shiftId: String(row.shift_id),
    cashierName: String(row.cashier_name),
    customerName: row.customer_name === null ? null : String(row.customer_name),
    itemsSold: toInt(row.items_sold),
    totalMinor: toInt(row.total_minor),
    taxTotalMinor: toInt(row.tax_total_minor),
    changeMinor: toInt(row.change_minor),
    creditMinor: toInt(row.credit_amount_minor),
    conflictCount: toInt(row.conflict_count),
    refundedMinor: toInt(row.refunded_minor),
  }
}

export async function selectSaleRows(
  filters: SaleFilters,
  executor: DbExecutor,
): Promise<{ rows: OversightSaleRow[]; total: number }> {
  const where = saleConditions(filters)

  const [countRow] = (
    await executor.execute<{ total: string }>(
      sql`SELECT COUNT(*)::bigint AS total FROM sale s WHERE ${where}`,
    )
  ).rows
  const rows = (
    await executor.execute<Record<string, unknown>>(sql`
      ${SALE_ROW_SELECT}
      WHERE ${where}
      ORDER BY s.occurred_at DESC, s.id DESC
      LIMIT ${filters.limit} OFFSET ${filters.offset}
    `)
  ).rows

  return { rows: rows.map(toSaleRow), total: toInt(countRow?.total) }
}

/** One sale's list row, for the detail, the receipt and the object-level scope check. */
export async function findSaleRow(
  saleId: string,
  executor: DbExecutor,
): Promise<OversightSaleRow | null> {
  const row = (
    await executor.execute<Record<string, unknown>>(sql`
      ${SALE_ROW_SELECT}
      WHERE s.id = ${saleId}
    `)
  ).rows[0]
  return row ? toSaleRow(row) : null
}

/**
 * A sale line is printed from its own snapshot: the SKU and the name are what
 * the customer's receipt says, never the live product (Phase 13's rule for the
 * refund subject, applied to the copy).
 */
export async function selectSaleLines(
  saleId: string,
  executor: DbExecutor,
): Promise<OversightSaleLine[]> {
  const rows = await executor
    .select()
    .from(saleLine)
    .where(eq(saleLine.saleId, saleId))
    .orderBy(asc(saleLine.lineNumber))

  return rows.map((row) => ({
    lineNumber: row.lineNumber,
    productId: row.productId,
    sku: row.sku,
    name: row.name,
    barcode: row.barcode,
    quantity: row.quantity,
    unitPriceMinor: row.unitPriceMinor,
    expectedUnitPriceMinor: row.expectedUnitPriceMinor,
    lineDiscountMinor: row.lineDiscountMinor,
    saleDiscountMinor: row.saleDiscountMinor,
    loyaltyDiscountMinor: row.loyaltyDiscountMinor,
    netMinor: row.netMinor,
    taxableMinor: row.taxableMinor,
    baseMinor: row.baseMinor,
    vatMinor: row.vatMinor,
    nhilMinor: row.nhilMinor,
    getfundMinor: row.getfundMinor,
    taxTotalMinor: row.taxTotalMinor,
    totalMinor: row.totalMinor,
    taxCategory: row.taxCategory,
  }))
}

/** The tenders in the order the customer paid them (P13-D1). */
export async function selectSaleTenders(
  saleId: string,
  executor: DbExecutor,
): Promise<OversightSaleTender[]> {
  const rows = await executor
    .select({
      sequence: saleTender.sequence,
      method: saleTender.method,
      amountMinor: saleTender.amountMinor,
      reference: saleTender.reference,
    })
    .from(saleTender)
    .where(eq(saleTender.saleId, saleId))
    .orderBy(asc(saleTender.sequence))

  return rows.map((row) => ({
    sequence: row.sequence,
    method: row.method,
    amountMinor: row.amountMinor,
    reference: row.reference,
  }))
}

/** The refunds booked against one sale, oldest first. */
export async function selectSaleRefunds(
  saleId: string,
  executor: DbExecutor,
): Promise<OversightSaleRefundRef[]> {
  const rows = await executor
    .select({
      id: refund.id,
      number: refund.number,
      refundedMinor: refund.refundedMinor,
      occurredAt: refund.occurredAt,
    })
    .from(refund)
    .where(eq(refund.saleId, saleId))
    .orderBy(asc(refund.occurredAt))

  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    refundedMinor: row.refundedMinor,
    occurredAt: row.occurredAt.toISOString(),
  }))
}

/**
 * The conflicts that name a sale, ids and codes only. The queue and its detail
 * are Plan 04's; this is the link a reviewer clicks.
 */
export async function selectSaleConflicts(
  saleId: string,
  executor: DbExecutor,
): Promise<OversightSaleConflictRef[]> {
  const rows = (
    await executor.execute<Record<string, unknown>>(sql`
      SELECT id, type, severity, status, resolution_code
      FROM sync_conflict
      WHERE sale_id = ${saleId}
      ORDER BY created_at DESC
    `)
  ).rows

  return rows.map((row) => ({
    id: String(row.id),
    type: String(row.type),
    severity: String(row.severity) as OversightSaleConflictRef['severity'],
    status: String(row.status) as OversightSaleConflictRef['status'],
    resolutionCode: (row.resolution_code ?? null) as OversightSaleConflictRef['resolutionCode'],
  }))
}

/** The branch, terminal, cashier and customer a receipt copy's header needs. */
export interface SaleReceiptHeader {
  sale: typeof sale.$inferSelect
  branchName: string
  branchCode: string
  terminalCode: string
  cashierName: string
  customerName: string | null
  customerPhone: string | null
}

export async function findSaleReceiptHeader(
  saleId: string,
  executor: DbExecutor,
): Promise<SaleReceiptHeader | null> {
  const rows = await executor
    .select({
      sale,
      branchName: branch.name,
      branchCode: branch.code,
      terminalCode: terminal.code,
      cashierName: userTable.name,
      customerName: customer.name,
      customerPhone: customer.phone,
    })
    .from(sale)
    .innerJoin(branch, eq(branch.id, sale.branchId))
    .innerJoin(terminal, eq(terminal.id, sale.terminalId))
    .leftJoin(userTable, eq(userTable.id, sale.cashierUserId))
    .leftJoin(customer, eq(customer.id, sale.customerId))
    .where(eq(sale.id, saleId))
    .limit(1)

  const row = rows[0]
  if (!row) return null
  return {
    sale: row.sale,
    branchName: row.branchName,
    branchCode: row.branchCode,
    terminalCode: row.terminalCode,
    // The staff snapshot is the fallback, exactly as the till prints it.
    cashierName: row.cashierName ?? row.sale.cashierStaffId,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
  }
}

/**
 * GRA's certificate for a sale, when there is one. Plan 07 owns writes to
 * `evat_submission`; this is the receipt copy's read of the bytes it holds, and
 * `qr_payload` is returned as GRA sent it, never composed here (P14-D35).
 */
export async function findCertifiedEvatForSale(
  saleId: string,
  executor: DbExecutor,
): Promise<ReceiptEvatBlock | null> {
  const rows = await executor
    .select({
      providerInvoiceNumber: evatSubmission.providerInvoiceNumber,
      sdcId: evatSubmission.sdcId,
      serial: evatSubmission.serial,
      signature: evatSubmission.signature,
      internalData: evatSubmission.internalData,
      machineCode: evatSubmission.machineCode,
      stampedAt: evatSubmission.stampedAt,
      qrPayload: evatSubmission.qrPayload,
    })
    .from(evatSubmission)
    .where(and(eq(evatSubmission.saleId, saleId), eq(evatSubmission.status, 'CERTIFIED')))
    .limit(1)

  const row = rows[0]
  if (!row) return null
  return {
    providerInvoiceNumber: row.providerInvoiceNumber,
    sdcId: row.sdcId,
    serial: row.serial,
    signature: row.signature,
    internalData: row.internalData,
    machineCode: row.machineCode,
    stampedAt: row.stampedAt?.toISOString() ?? null,
    qrPayload: row.qrPayload,
  }
}

// --- Refunds ----------------------------------------------------------------

export interface RefundFilters {
  branchId: string | null
  from: Date | null
  toExclusive: Date | null
  terminalId: string | null
  reasonCode: RefundReason | null
  /** Filters on the refund's tenders: any allocation with this method/status. */
  method: TenderMethod | null
  tenderStatus: OversightRefundTender['status'] | null
  limit: number
  offset: number
}

function refundConditions(filters: RefundFilters): SQL {
  return conjunction([
    branchClause(sql`r.branch_id`, filters.branchId),
    windowClause(sql`r.occurred_at`, filters.from, filters.toExclusive),
    filters.terminalId === null ? null : sql`r.terminal_id = ${filters.terminalId}`,
    filters.reasonCode === null ? null : sql`r.reason_code = ${filters.reasonCode}`,
    filters.method === null
      ? null
      : sql`EXISTS (SELECT 1 FROM refund_tender rt WHERE rt.refund_id = r.id AND rt.method = ${filters.method})`,
    filters.tenderStatus === null
      ? null
      : sql`EXISTS (SELECT 1 FROM refund_tender rt WHERE rt.refund_id = r.id AND rt.status = ${filters.tenderStatus})`,
  ])
}

/**
 * The refund list row.
 *
 * **Any amount is listed.** Phase 13's console could see the refunds it was asked
 * to approve and none of the ones it was not; a threshold is a reason to review a
 * refund, not a reason to hide one (Plan 03 §7).
 *
 * A refund has no cashier column — the till writes the approver — so the row
 * carries `approvedBy` rather than a `cashierName` the table cannot supply.
 */
const REFUND_ROW_SELECT = sql`
  SELECT
    r.id,
    r.number,
    r.occurred_at,
    r.branch_id,
    r.sale_id,
    r.shift_id,
    r.refunded_minor,
    r.reason_code,
    r.note,
    r.approval_id,
    r.approved_by_staff_id,
    r.approved_at,
    r.base_minor,
    r.vat_minor,
    r.nhil_minor,
    r.getfund_minor,
    r.tax_total_minor,
    b.code AS branch_code,
    b.name AS branch_name,
    t.code AS terminal_code,
    s.receipt_number,
    COALESCE(u.name, r.approved_by_staff_id) AS approved_by,
    (SELECT COUNT(*) FROM refund_tender rt WHERE rt.refund_id = r.id)::bigint AS tender_count,
    EXISTS (SELECT 1 FROM refund_tender rt WHERE rt.refund_id = r.id AND rt.status <> 'SETTLED')
      AS has_pending_tender
  FROM refund r
  JOIN branch b ON b.id = r.branch_id
  JOIN terminal t ON t.id = r.terminal_id
  JOIN sale s ON s.id = r.sale_id
  LEFT JOIN "user" u ON u.id = r.approved_by_user_id
`

function toRefundRow(row: Record<string, unknown>): OversightRefundRow {
  return {
    id: String(row.id),
    number: String(row.number),
    occurredAt: toIso(row.occurred_at),
    branchId: String(row.branch_id),
    branchCode: String(row.branch_code),
    branchName: String(row.branch_name),
    terminalCode: String(row.terminal_code),
    saleId: String(row.sale_id),
    shiftId: String(row.shift_id),
    receiptNumber: String(row.receipt_number),
    refundedMinor: toInt(row.refunded_minor),
    reasonCode: String(row.reason_code) as RefundReason,
    tenderCount: toInt(row.tender_count),
    hasPendingTender: toBoolean(row.has_pending_tender),
    approvalId: row.approval_id === null ? null : String(row.approval_id),
    approvedBy: row.approved_by === null ? null : String(row.approved_by),
    approvedByStaffId: String(row.approved_by_staff_id),
  }
}

export async function selectRefundRows(
  filters: RefundFilters,
  executor: DbExecutor,
): Promise<{ rows: OversightRefundRow[]; total: number }> {
  const where = refundConditions(filters)

  const [countRow] = (
    await executor.execute<{ total: string }>(
      sql`SELECT COUNT(*)::bigint AS total FROM refund r WHERE ${where}`,
    )
  ).rows
  const rows = (
    await executor.execute<Record<string, unknown>>(sql`
      ${REFUND_ROW_SELECT}
      WHERE ${where}
      ORDER BY r.occurred_at DESC, r.id DESC
      LIMIT ${filters.limit} OFFSET ${filters.offset}
    `)
  ).rows

  return { rows: rows.map(toRefundRow), total: toInt(countRow?.total) }
}

export interface RefundTaxSplit {
  baseMinor: number
  vatMinor: number
  nhilMinor: number
  getfundMinor: number
  taxTotalMinor: number
}

export interface RefundRowDetail {
  row: OversightRefundRow
  note: string | null
  approvedAt: string
  taxSplit: RefundTaxSplit
}

/** One refund's row plus the header detail (note, tax split); null when absent. */
export async function findRefundRow(
  refundId: string,
  executor: DbExecutor,
): Promise<RefundRowDetail | null> {
  const row = (
    await executor.execute<Record<string, unknown>>(sql`
      ${REFUND_ROW_SELECT}
      WHERE r.id = ${refundId}
    `)
  ).rows[0]
  if (!row) return null

  return {
    row: toRefundRow(row),
    note: row.note === null ? null : String(row.note),
    approvedAt: toIso(row.approved_at),
    taxSplit: {
      baseMinor: toInt(row.base_minor),
      vatMinor: toInt(row.vat_minor),
      nhilMinor: toInt(row.nhil_minor),
      getfundMinor: toInt(row.getfund_minor),
      taxTotalMinor: toInt(row.tax_total_minor),
    },
  }
}

/**
 * A refund's lines, joined to the `sale_line` it unwinds for the name and SKU the
 * customer's receipt carries. Ordered by the refund's own numbering.
 *
 * This is not `selectRefundLineEvidence`: that selector feeds the approval subject
 * and its shape is Plan 13's contract. A reviewer of a closed refund needs the tax
 * columns as well, so the read lives here rather than widening that one.
 */
export async function selectRefundOversightLines(
  refundId: string,
  executor: DbExecutor,
): Promise<OversightRefundLine[]> {
  const rows = await executor
    .select({
      lineNumber: refundLine.lineNumber,
      productId: refundLine.productId,
      productName: saleLine.name,
      sku: saleLine.sku,
      quantity: refundLine.quantity,
      unitPriceMinor: refundLine.unitPriceMinor,
      restock: refundLine.restock,
      damageReason: refundLine.damageReason,
      baseMinor: refundLine.baseMinor,
      vatMinor: refundLine.vatMinor,
      nhilMinor: refundLine.nhilMinor,
      getfundMinor: refundLine.getfundMinor,
      taxTotalMinor: refundLine.taxTotalMinor,
      totalMinor: refundLine.totalMinor,
    })
    .from(refundLine)
    .innerJoin(saleLine, eq(saleLine.id, refundLine.saleLineId))
    .where(eq(refundLine.refundId, refundId))
    .orderBy(asc(refundLine.lineNumber))

  return rows.map((row) => ({ ...row }))
}

// --- Shifts -----------------------------------------------------------------

export interface ShiftFilters {
  branchId: string | null
  from: Date | null
  toExclusive: Date | null
  terminalId: string | null
  cashierStaffId: string | null
  status: 'OPEN' | 'CLOSED' | null
  reviewStatus: OversightShiftRow['reviewStatus'] | null
  limit: number
  offset: number
}

function shiftConditions(filters: ShiftFilters): SQL {
  return conjunction([
    branchClause(sql`"shift".branch_id`, filters.branchId),
    windowClause(sql`"shift".opened_at`, filters.from, filters.toExclusive),
    filters.terminalId === null ? null : sql`"shift".terminal_id = ${filters.terminalId}`,
    filters.cashierStaffId === null
      ? null
      : sql`"shift".cashier_staff_id = ${filters.cashierStaffId}`,
    filters.status === null ? null : sql`"shift".status = ${filters.status}`,
    filters.reviewStatus === null ? null : sql`"shift".review_status = ${filters.reviewStatus}`,
  ])
}

const SHIFT_ROW_SELECT = {
  id: shift.id,
  number: shift.number,
  status: shift.status,
  reviewStatus: shift.reviewStatus,
  branchId: shift.branchId,
  branchCode: branch.code,
  branchName: branch.name,
  terminalCode: terminal.code,
  cashierName: sql<string>`COALESCE(${userTable.name}, ${shift.cashierStaffId})`,
  openedAt: shift.openedAt,
  closedAt: shift.closedAt,
  openingFloatMinor: shift.openingFloatMinor,
  serverExpectedCashMinor: shift.serverExpectedCashMinor,
  countedCashMinor: shift.countedCashMinor,
  varianceMinor: shift.varianceMinor,
  hasReport: sql<boolean>`EXISTS (SELECT 1 FROM shift_report sr WHERE sr.shift_id = shift.id)`,
}

function shiftRowBuilder(executor: DbExecutor) {
  return executor
    .select(SHIFT_ROW_SELECT)
    .from(shift)
    .innerJoin(branch, eq(branch.id, shift.branchId))
    .innerJoin(terminal, eq(terminal.id, shift.terminalId))
    .leftJoin(userTable, eq(userTable.id, shift.cashierUserId))
}

function toShiftRow(row: {
  id: string
  number: string
  status: 'OPEN' | 'CLOSED'
  reviewStatus: OversightShiftRow['reviewStatus']
  branchId: string
  branchCode: string
  branchName: string
  terminalCode: string
  cashierName: string
  openedAt: Date
  closedAt: Date | null
  openingFloatMinor: number
  serverExpectedCashMinor: number | null
  countedCashMinor: number | null
  varianceMinor: number | null
  hasReport: boolean
}): OversightShiftRow {
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    reviewStatus: row.reviewStatus,
    branchId: row.branchId,
    branchCode: row.branchCode,
    branchName: row.branchName,
    terminalCode: row.terminalCode,
    cashierName: row.cashierName,
    openedAt: row.openedAt.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null,
    openingFloatMinor: row.openingFloatMinor,
    // Null until a close has written them: an open shift has no variance yet.
    serverExpectedCashMinor: toOptionalInt(row.serverExpectedCashMinor),
    countedCashMinor: toOptionalInt(row.countedCashMinor),
    varianceMinor: toOptionalInt(row.varianceMinor),
    hasReport: toBoolean(row.hasReport),
  }
}

export async function selectShiftRows(
  filters: ShiftFilters,
  executor: DbExecutor,
): Promise<{ rows: OversightShiftRow[]; total: number }> {
  const where = shiftConditions(filters)

  const [countRow] = (
    await executor.execute<{ total: string }>(
      sql`SELECT COUNT(*)::bigint AS total FROM shift WHERE ${where}`,
    )
  ).rows
  const rows = await shiftRowBuilder(executor)
    .where(where)
    .orderBy(desc(shift.openedAt), desc(shift.id))
    .limit(filters.limit)
    .offset(filters.offset)

  return { rows: rows.map(toShiftRow), total: toInt(countRow?.total) }
}

export async function findShiftRow(
  shiftId: string,
  executor: DbExecutor,
): Promise<OversightShiftRow | null> {
  const rows = await shiftRowBuilder(executor).where(eq(shift.id, shiftId)).limit(1)
  const row = rows[0]
  return row ? toShiftRow(row) : null
}

/**
 * A shift's abandoned carts, oldest first. `cart_void` was written by the till in
 * Phase 13 and has had no read path since (research fact 20); this is it.
 */
export async function selectShiftVoids(
  shiftId: string,
  executor: DbExecutor,
): Promise<OversightVoidRow[]> {
  const rows = await executor
    .select({
      id: cartVoid.id,
      occurredAt: cartVoid.occurredAt,
      reasonCode: cartVoid.reasonCode,
      label: cartVoid.label,
      itemCount: cartVoid.itemCount,
      grossMinor: cartVoid.grossMinor,
      cashierName: sql<string>`COALESCE(${userTable.name}, ${cartVoid.cashierStaffId})`,
    })
    .from(cartVoid)
    .leftJoin(userTable, eq(userTable.id, cartVoid.cashierUserId))
    .where(eq(cartVoid.shiftId, shiftId))
    .orderBy(asc(cartVoid.occurredAt))

  return rows.map((row) => ({
    id: row.id,
    occurredAt: row.occurredAt.toISOString(),
    reasonCode: row.reasonCode,
    reasonLabel: CART_VOID_REASON_LABELS[row.reasonCode],
    label: row.label,
    itemCount: row.itemCount,
    grossMinor: row.grossMinor,
    cashierName: row.cashierName,
  }))
}
