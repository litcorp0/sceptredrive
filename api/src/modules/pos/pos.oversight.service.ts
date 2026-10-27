/**
 * Oversight reads (Phase 14, Plan 03) — the documents a manager needs at 10:00.
 *
 * This service composes one document at a time: a sale, a refund, a shift. It
 * never aggregates (that is analytics, P14-D2) and it never writes (P14-D13).
 *
 * Authorisation is one rule applied twice:
 *
 * - a **list** is scoped by `resolveBranchFilter`, so an admin may read every
 *   branch and a manager is pinned to their own;
 * - an **object** is scoped by `resolveBranchFilter` on the branch the row
 *   actually holds, so a foreign id is a 403 rather than a 404 that hides
 *   existence (P14-D7, OWASP A01).
 */
import { db } from '@sceptre/db'
import { accraDayBounds } from '@sceptre/shared'
import { resolveBranchFilter } from '../../auth/scope.ts'
import { NotFoundError, ValidationError } from '../../http/errors.ts'
import type { SessionUser } from '../../http/factory.ts'
import * as repository from './pos.oversight.repository.ts'
import { selectRefundTenders } from './pos.repository.ts'
import type {
  OversightRefundDetail,
  OversightRefundsList,
  OversightRefundTender,
  OversightSaleDetail,
  OversightSalesList,
  OversightShiftsList,
} from './pos.types.ts'
import type {
  OversightRefundsQuery,
  OversightSalesQuery,
  OversightShiftsQuery,
} from './pos.validation.ts'

interface DayWindow {
  from: Date | null
  toExclusive: Date | null
}

/**
 * `from`/`to` are inclusive Accra days; the window handed to SQL is half-open on
 * the next midnight, which is what `accraDayBounds` exists for (and what keeps the
 * `(branch_id, occurred_at)` indexes usable).
 */
export function resolveDayWindow(from?: string, to?: string): DayWindow {
  const fromDate = from ? new Date(accraDayBounds(new Date(`${from}T00:00:00.000Z`)).from) : null
  const toExclusive = to ? new Date(accraDayBounds(new Date(`${to}T00:00:00.000Z`)).to) : null

  if (fromDate && toExclusive && fromDate.getTime() >= toExclusive.getTime()) {
    throw new ValidationError('from must be on or before to')
  }
  return { from: fromDate, toExclusive }
}

/** The branch a list may read: an admin's request, a manager's own branch, or a 403. */
function scopeFor(user: SessionUser, requestedBranchId: string | undefined): string | null {
  return resolveBranchFilter(user, requestedBranchId ?? null)
}

/**
 * The branch a single document may be read from. `resolveBranchFilter` throws a
 * 403 for a manager who names another branch, which is exactly the rule; no
 * second comparison is written here.
 */
function assertDocumentScope(user: SessionUser, branchId: string): void {
  resolveBranchFilter(user, branchId)
}

// --- Sales ------------------------------------------------------------------

export async function listSales(
  user: SessionUser,
  query: OversightSalesQuery,
): Promise<OversightSalesList> {
  const window = resolveDayWindow(query.from, query.to)
  const result = await repository.selectSaleRows(
    {
      branchId: scopeFor(user, query.branchId),
      from: window.from,
      toExclusive: window.toExclusive,
      terminalId: query.terminalId ?? null,
      cashierStaffId: query.cashierStaffId ?? null,
      receiptNumber: query.receiptNumber ?? null,
      limit: query.limit,
      offset: query.offset,
    },
    db,
  )

  return { sales: result.rows, total: result.total, limit: query.limit, offset: query.offset }
}

/**
 * One sale, with the lines it was built from, the money that settled it, the
 * refunds that reversed part of it and the conflicts it raised.
 *
 * Every part is read from the row that owns it; nothing here re-adds a total.
 */
export async function getSale(user: SessionUser, saleId: string): Promise<OversightSaleDetail> {
  const sale = await repository.findSaleRow(saleId, db)
  if (!sale) throw new NotFoundError('Sale not found')
  assertDocumentScope(user, sale.branchId)

  const [lines, tenders, refunds, conflicts] = await Promise.all([
    repository.selectSaleLines(saleId, db),
    repository.selectSaleTenders(saleId, db),
    repository.selectSaleRefunds(saleId, db),
    repository.selectSaleConflicts(saleId, db),
  ])

  return { sale, lines, tenders, refunds, conflicts }
}

// --- Refunds ----------------------------------------------------------------

export async function listRefunds(
  user: SessionUser,
  query: OversightRefundsQuery,
): Promise<OversightRefundsList> {
  const window = resolveDayWindow(query.from, query.to)
  const result = await repository.selectRefundRows(
    {
      branchId: scopeFor(user, query.branchId),
      from: window.from,
      toExclusive: window.toExclusive,
      terminalId: query.terminalId ?? null,
      reasonCode: query.reasonCode ?? null,
      method: query.method ?? null,
      tenderStatus: query.tenderStatus ?? null,
      limit: query.limit,
      offset: query.offset,
    },
    db,
  )

  return { refunds: result.rows, total: result.total, limit: query.limit, offset: query.offset }
}

/** One refund: the document, what came back and where the money went. */
export async function getRefund(
  user: SessionUser,
  refundId: string,
): Promise<OversightRefundDetail> {
  const detail = await repository.findRefundRow(refundId, db)
  if (!detail) throw new NotFoundError('Refund not found')
  assertDocumentScope(user, detail.row.branchId)

  const [lines, tenderRows] = await Promise.all([
    repository.selectRefundOversightLines(refundId, db),
    selectRefundTenders(refundId),
  ])

  const tenders: OversightRefundTender[] = tenderRows.map((tender) => ({
    sequence: tender.sequence,
    method: tender.method,
    amountMinor: tender.amountMinor,
    status: tender.status,
    settledAt: tender.settledAt?.toISOString() ?? null,
    providerRefundReference: tender.providerRefundReference,
    failedMessage: tender.failedMessage,
  }))

  return {
    refund: {
      ...detail.row,
      note: detail.note,
      approvedAt: detail.approvedAt,
      ...detail.taxSplit,
    },
    lines,
    tenders,
  }
}

// --- Shifts -----------------------------------------------------------------

export async function listShifts(
  user: SessionUser,
  query: OversightShiftsQuery,
): Promise<OversightShiftsList> {
  const window = resolveDayWindow(query.from, query.to)
  const result = await repository.selectShiftRows(
    {
      branchId: scopeFor(user, query.branchId),
      from: window.from,
      toExclusive: window.toExclusive,
      terminalId: query.terminalId ?? null,
      cashierStaffId: query.cashierStaffId ?? null,
      status: query.status ?? null,
      reviewStatus: query.reviewStatus ?? null,
      limit: query.limit,
      offset: query.offset,
    },
    db,
  )

  return { shifts: result.rows, total: result.total, limit: query.limit, offset: query.offset }
}
