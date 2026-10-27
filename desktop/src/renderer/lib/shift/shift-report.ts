import type { Transaction } from '@powersync/web'
import type { ShiftReportFigures } from '../receipt/report-render'
import type { LocalShift, SqlReader } from './shift-repository'

/**
 * The local Z figures (P13-D32).
 *
 * `selectShiftReportFigures` on the server is the contract; this is the same
 * arithmetic over the till's own rows, so a printed Z and the console's copy
 * cannot disagree about a figure. The snapshot is written once, by the close,
 * with the `SHIFT_CLOSE` outbox row beside it.
 *
 * `readShiftFigures` returns the aggregates only. The drawer columns come from
 * the shift row itself plus `computeExpectedCash`, the one formula the close
 * uses — so a report can never invent an expected figure of its own.
 */

export interface ShiftSaleFigures {
  saleCount: number
  itemCount: number
  refundCount: number
  voidCount: number
  grossMinor: number
  refundMinor: number
  lineDiscountMinor: number
  saleDiscountMinor: number
  loyaltyDiscountMinor: number
  loyaltyRedeemPoints: number
  loyaltyEarnedPoints: number
  baseMinor: number
  vatMinor: number
  nhilMinor: number
  getfundMinor: number
  taxTotalMinor: number
  cashMinor: number
  creditMinor: number
  momoMinor: number
  cardMinor: number
  bankTransferMinor: number
  changeMinor: number
  cashInMinor: number
  cashOutMinor: number
}

export interface LocalShiftReport extends ShiftReportFigures {
  shiftId: string
  branchId: string
  terminalId: string
  deviceId: string
  number: string
  openedAt: string
  closedAt: string
  generatedAt: string
}

const FIGURES_SQL = `SELECT
  (SELECT COUNT(*) FROM sale WHERE shift_id = ?) AS sale_count,
  (SELECT COALESCE(SUM(total_minor), 0) FROM sale WHERE shift_id = ?) AS gross_minor,
  (SELECT COALESCE(SUM(line_discount_minor), 0) FROM sale WHERE shift_id = ?)
    AS line_discount_minor,
  (SELECT COALESCE(SUM(sale_discount_minor), 0) FROM sale WHERE shift_id = ?)
    AS sale_discount_minor,
  (SELECT COALESCE(SUM(loyalty_discount_minor), 0) FROM sale WHERE shift_id = ?)
    AS loyalty_discount_minor,
  (SELECT COALESCE(SUM(loyalty_redeem_points), 0) FROM sale WHERE shift_id = ?)
    AS loyalty_redeem_points,
  (SELECT COALESCE(SUM(loyalty_earned_points), 0) FROM sale WHERE shift_id = ?)
    AS loyalty_earned_points,
  (SELECT COALESCE(SUM(vat_minor), 0) FROM sale WHERE shift_id = ?) AS vat_minor,
  (SELECT COALESCE(SUM(nhil_minor), 0) FROM sale WHERE shift_id = ?) AS nhil_minor,
  (SELECT COALESCE(SUM(getfund_minor), 0) FROM sale WHERE shift_id = ?) AS getfund_minor,
  (SELECT COALESCE(SUM(tax_total_minor), 0) FROM sale WHERE shift_id = ?) AS tax_total_minor,
  (SELECT COALESCE(SUM(change_minor), 0) FROM sale WHERE shift_id = ?) AS change_minor,
  (SELECT COALESCE(SUM(sl.quantity), 0) FROM sale_line sl
     JOIN sale s ON s.id = sl.sale_id WHERE s.shift_id = ?) AS item_count,
  (SELECT COALESCE(SUM(sl.base_minor), 0) FROM sale_line sl
     JOIN sale s ON s.id = sl.sale_id WHERE s.shift_id = ?) AS base_minor,
  (SELECT COALESCE(SUM(st.amount_minor), 0) FROM sale_tender st
     JOIN sale s ON s.id = st.sale_id WHERE s.shift_id = ? AND st.method = 'CASH') AS cash_minor,
  (SELECT COALESCE(SUM(st.amount_minor), 0) FROM sale_tender st
     JOIN sale s ON s.id = st.sale_id WHERE s.shift_id = ? AND st.method = 'CREDIT')
    AS credit_minor,
  (SELECT COALESCE(SUM(st.amount_minor), 0) FROM sale_tender st
     JOIN sale s ON s.id = st.sale_id WHERE s.shift_id = ? AND st.method = 'MOMO') AS momo_minor,
  (SELECT COALESCE(SUM(st.amount_minor), 0) FROM sale_tender st
     JOIN sale s ON s.id = st.sale_id WHERE s.shift_id = ? AND st.method = 'CARD') AS card_minor,
  (SELECT COALESCE(SUM(st.amount_minor), 0) FROM sale_tender st
     JOIN sale s ON s.id = st.sale_id WHERE s.shift_id = ? AND st.method = 'BANK_TRANSFER')
    AS bank_transfer_minor,
  (SELECT COUNT(*) FROM refund WHERE shift_id = ?) AS refund_count,
  (SELECT COALESCE(SUM(refunded_minor), 0) FROM refund WHERE shift_id = ?) AS refund_minor,
  (SELECT COUNT(*) FROM cart_void WHERE shift_id = ?) AS void_count,
  (SELECT COALESCE(SUM(amount_minor), 0) FROM cash_movement
     WHERE shift_id = ? AND type = 'CASH_IN') AS cash_in_minor,
  (SELECT COALESCE(SUM(amount_minor), 0) FROM cash_movement
     WHERE shift_id = ? AND type = 'CASH_OUT') AS cash_out_minor`

/** One read: every aggregate a report prints, all filtered by the shift. */
export async function readShiftFigures(
  reader: SqlReader,
  shiftId: string,
): Promise<ShiftSaleFigures> {
  const row = await reader.getOptional<Record<string, number | null>>(FIGURES_SQL, [
    shiftId,
    shiftId,
    shiftId,
    shiftId,
    shiftId,
    shiftId,
    shiftId,
    shiftId,
    shiftId,
    shiftId,
    shiftId,
    shiftId,
    shiftId,
    shiftId,
    shiftId,
    shiftId,
    shiftId,
    shiftId,
    shiftId,
    shiftId,
    shiftId,
    shiftId,
    shiftId,
    shiftId,
  ])

  const int = (key: string): number => {
    const value = row?.[key]
    return typeof value === 'number' && Number.isFinite(value) ? value : 0
  }

  return {
    saleCount: int('sale_count'),
    itemCount: int('item_count'),
    refundCount: int('refund_count'),
    voidCount: int('void_count'),
    grossMinor: int('gross_minor'),
    refundMinor: int('refund_minor'),
    lineDiscountMinor: int('line_discount_minor'),
    saleDiscountMinor: int('sale_discount_minor'),
    loyaltyDiscountMinor: int('loyalty_discount_minor'),
    loyaltyRedeemPoints: int('loyalty_redeem_points'),
    loyaltyEarnedPoints: int('loyalty_earned_points'),
    baseMinor: int('base_minor'),
    vatMinor: int('vat_minor'),
    nhilMinor: int('nhil_minor'),
    getfundMinor: int('getfund_minor'),
    taxTotalMinor: int('tax_total_minor'),
    cashMinor: int('cash_minor'),
    creditMinor: int('credit_minor'),
    momoMinor: int('momo_minor'),
    cardMinor: int('card_minor'),
    bankTransferMinor: int('bank_transfer_minor'),
    changeMinor: int('change_minor'),
    cashInMinor: int('cash_in_minor'),
    cashOutMinor: int('cash_out_minor'),
  }
}

/**
 * The snapshot as it is stored: the aggregates plus the drawer, which is the
 * shift row's own arithmetic and never a second computation.
 */
export function localShiftReport(
  shift: LocalShift,
  figures: ShiftSaleFigures,
  expectedCashMinor: number,
  generatedAt: string,
): LocalShiftReport {
  const countedCashMinor = shift.countedCashMinor ?? 0
  return {
    ...figures,
    shiftId: shift.id,
    branchId: shift.branchId,
    terminalId: shift.terminalId,
    deviceId: shift.deviceId,
    number: shift.number,
    openedAt: shift.openedAt,
    closedAt: shift.closedAt ?? generatedAt,
    generatedAt,
    netMinor: figures.grossMinor - figures.refundMinor,
    openingFloatMinor: shift.openingFloatMinor,
    expectedCashMinor,
    countedCashMinor,
    varianceMinor: countedCashMinor - expectedCashMinor,
  }
}

/**
 * Writes the snapshot, keyed by the shift.
 *
 * The row id **is** the shift id, so one drawer cannot hold two reports, and the
 * statement is a plain `INSERT`: there is no update path on a Z, exactly as on
 * the server (P13-D32). It runs inside the close transaction, so a failure takes
 * the close with it and the shift stays open.
 */
export async function writeShiftReport(tx: Transaction, report: LocalShiftReport): Promise<void> {
  await tx.execute(
    `INSERT INTO shift_report
       (id, shift_id, branch_id, terminal_id, device_id, number, opened_at, closed_at,
        opening_float_minor, sale_count, item_count, refund_count, void_count, gross_minor,
        refund_minor, net_minor, line_discount_minor, sale_discount_minor,
        loyalty_discount_minor, loyalty_redeem_points, loyalty_earned_points, base_minor,
        vat_minor, nhil_minor, getfund_minor, tax_total_minor, cash_minor, credit_minor,
        momo_minor, card_minor, bank_transfer_minor, change_minor, cash_in_minor, cash_out_minor,
        expected_cash_minor, counted_cash_minor, variance_minor, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
             ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      // The row id is the shift id: one report per drawer, enforced locally the
      // same way `unique(shift_id)` enforces it on the server.
      report.shiftId,
      report.shiftId,
      report.branchId,
      report.terminalId,
      report.deviceId,
      report.number,
      report.openedAt,
      report.closedAt,
      report.openingFloatMinor,
      report.saleCount,
      report.itemCount,
      report.refundCount,
      report.voidCount,
      report.grossMinor,
      report.refundMinor,
      report.netMinor,
      report.lineDiscountMinor,
      report.saleDiscountMinor,
      report.loyaltyDiscountMinor,
      report.loyaltyRedeemPoints,
      report.loyaltyEarnedPoints,
      report.baseMinor,
      report.vatMinor,
      report.nhilMinor,
      report.getfundMinor,
      report.taxTotalMinor,
      report.cashMinor,
      report.creditMinor,
      report.momoMinor,
      report.cardMinor,
      report.bankTransferMinor,
      report.changeMinor,
      report.cashInMinor,
      report.cashOutMinor,
      report.expectedCashMinor,
      report.countedCashMinor,
      report.varianceMinor,
      report.generatedAt,
    ],
  )
}
