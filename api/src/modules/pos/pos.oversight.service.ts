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
import { getSettingValue } from '../platform/settings.service.ts'
import * as repository from './pos.oversight.repository.ts'
import { findShiftReportByShiftId, selectRefundTenders } from './pos.repository.ts'
import { readShiftReport } from './pos.service.ts'
import type {
  OversightRefundDetail,
  OversightRefundsList,
  OversightRefundTender,
  OversightSaleDetail,
  OversightSalesList,
  OversightShiftDetail,
  OversightShiftsList,
  ReceiptCopy,
  ShiftReportView,
} from './pos.types.ts'
import type {
  OversightRefundsQuery,
  OversightSalesQuery,
  OversightShiftsQuery,
  ShiftReportQuery,
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

/**
 * A phone number, masked server-side: `•••• 1234`, the same shape as
 * `maskAccountNumber` in suppliers (P14-D11). A client-side mask would be a
 * disclosure with extra steps, so the full number never leaves this function.
 */
export function maskPhone(phone: string | null): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 4) return '••••'
  return `•••• ${digits.slice(-4)}`
}

/**
 * The server-rendered **copy** of a sale's receipt (P14-D10).
 *
 * Every money field comes from the sale's own columns and every line from the
 * line's own snapshot, so the copy and the sale cannot disagree:
 * `Σ sale_line.total_minor === sale.total_minor` and
 * `Σ sale_tender.amount_minor − change === total_minor` are properties of the
 * rows, not of this function.
 *
 * It is a copy, and says so: the server does not know the till's print status and
 * must not pretend to (`isCopy`, `reprint`).
 */
export async function getReceiptCopy(user: SessionUser, saleId: string): Promise<ReceiptCopy> {
  const header = await repository.findSaleReceiptHeader(saleId, db)
  if (!header) throw new NotFoundError('Sale not found')
  assertDocumentScope(user, header.sale.branchId)

  const [lines, tenders, seller, footer, evat] = await Promise.all([
    repository.selectSaleLines(saleId, db),
    repository.selectSaleTenders(saleId, db),
    getSettingValue('receipt.header', { branchId: header.sale.branchId }),
    getSettingValue('pos.receiptFooter'),
    repository.findCertifiedEvatForSale(saleId, db),
  ])

  const row = header.sale
  const phoneMasked = maskPhone(header.customerPhone)
  const customer =
    header.customerName === null && phoneMasked === null
      ? null
      : { name: header.customerName ?? '', phoneMasked: phoneMasked ?? '' }

  return {
    header: {
      seller,
      branch: header.branchName,
      branchCode: header.branchCode,
      terminal: header.terminalCode,
      receiptNumber: row.receiptNumber,
      occurredAt: row.occurredAt.toISOString(),
      cashier: header.cashierName,
      customer,
      isCopy: true,
      reprint: false,
    },
    lines,
    totals: {
      subtotalMinor: row.subtotalMinor,
      lineDiscountMinor: row.lineDiscountMinor,
      saleDiscountMinor: row.saleDiscountMinor,
      loyaltyDiscountMinor: row.loyaltyDiscountMinor,
      // The till derives the same figure from the same two columns; the sale has
      // no taxable column and adding one for a receipt would be a second truth.
      taxableMinor: row.totalMinor - row.taxTotalMinor,
      vatMinor: row.vatMinor,
      nhilMinor: row.nhilMinor,
      getfundMinor: row.getfundMinor,
      taxTotalMinor: row.taxTotalMinor,
      totalMinor: row.totalMinor,
    },
    tenders,
    // The sale's stored tender total, not a sum taken here.
    tenderedMinor: row.tenderTotalMinor,
    changeMinor: row.changeMinor,
    loyalty:
      row.loyaltyEarnedPoints > 0 || row.loyaltyRedeemPoints > 0
        ? { earnedPoints: row.loyaltyEarnedPoints, redeemedPoints: row.loyaltyRedeemPoints }
        : null,
    footer,
    evat,
  }
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

/**
 * A shift with the document that belongs to it.
 *
 * A closed shift embeds its **stored** Z and never a recomputation (P14-D12). When
 * the snapshot is missing the detail says so — `reportState: 'MISSING'` — instead
 * of failing the screen the manager opened to find out: the strict refusal belongs
 * to the report route, where asking for a Z is an explicit question. An open shift
 * embeds a live X, which is what a drawer looks like right now.
 *
 * The voids are the shift's abandoned carts, the only read path `cart_void` has had
 * since the till started writing it (research fact 20).
 */
export async function getShift(user: SessionUser, shiftId: string): Promise<OversightShiftDetail> {
  const shiftRow = await repository.findShiftRow(shiftId, db)
  if (!shiftRow) throw new NotFoundError('Shift not found')
  assertDocumentScope(user, shiftRow.branchId)

  const [voidRows, snapshot] = await Promise.all([
    repository.selectShiftVoids(shiftId, db),
    findShiftReportByShiftId(shiftId),
  ])

  let report: ShiftReportView | null = null
  let reportState: OversightShiftDetail['reportState']
  if (shiftRow.status === 'CLOSED') {
    if (snapshot) {
      report = await readShiftReport({ branchId: shiftRow.branchId }, shiftId, 'Z')
      reportState = 'STORED'
    } else {
      reportState = 'MISSING'
    }
  } else {
    report = await readShiftReport({ branchId: shiftRow.branchId }, shiftId, 'X')
    reportState = 'LIVE'
  }

  return {
    shift: shiftRow,
    report,
    reportState,
    voids: {
      count: voidRows.length,
      itemCount: voidRows.reduce((sum, row) => sum + row.itemCount, 0),
      grossMinor: voidRows.reduce((sum, row) => sum + row.grossMinor, 0),
      rows: voidRows,
    },
  }
}

/**
 * The session-gated shift report (P14-D12).
 *
 * The gate is `resolveBranchFilter` on the shift's own branch, so a manager
 * asking for another branch's drawer is a **403** — not the device route's 404,
 * because a manager is allowed to know that a shift exists elsewhere. Both gates
 * then call the same `readShiftReport`, so the arithmetic cannot fork.
 */
export async function getShiftReport(
  user: SessionUser,
  shiftId: string,
  kind: ShiftReportQuery['kind'],
): Promise<ShiftReportView> {
  const shiftRow = await repository.findShiftRow(shiftId, db)
  if (!shiftRow) throw new NotFoundError('Shift not found')
  assertDocumentScope(user, shiftRow.branchId)
  return readShiftReport({ branchId: shiftRow.branchId }, shiftId, kind)
}
