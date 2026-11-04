import { describe, expect, it } from 'vitest'
import { DEFAULT_PRINTER_SETTINGS } from '@/lib/printing/settings'
import { reportDocumentText } from '@/lib/receipt/report-render'
import { localShiftReport, type ShiftSaleFigures } from '@/lib/shift/shift-report'
import type { LocalShift } from '@/lib/shift/shift-repository'
import { closedShiftDocument, reportPrintJob } from './print-report'

/**
 * The Z on its way to the printer (P14-D1).
 *
 * The report job is the receipt capability with a document attached: the main
 * process builds the bytes, so the job must carry the *figures* rather than a
 * pre-rendered block, and it must never open the cash drawer — a report is a
 * report, not a sale.
 */

const SHIFT: LocalShift = {
  id: 'shift-1',
  number: 'ACC-SPX-T01-S-20261027-01',
  branchId: 'branch-1',
  terminalId: 'terminal-1',
  deviceId: 'device-1',
  cashierUserId: 'user-cashier',
  cashierStaffId: 'SD-0003',
  status: 'CLOSED',
  openedAt: '2026-10-27T08:00:00.000Z',
  closedAt: '2026-10-27T18:30:00.000Z',
  openingFloatMinor: 100_000,
  countedCashMinor: 470_000,
  clientExpectedCashMinor: 470_000,
  closeNote: null,
  openedBy: 'SD-0003',
  closedBy: 'SD-0003',
  createdAt: '2026-10-27T08:00:00.000Z',
}

/** What `readShiftFigures` returns: one cash-refund figure, already summed. */
const FIGURES: ShiftSaleFigures = {
  saleCount: 2,
  itemCount: 3,
  refundCount: 1,
  voidCount: 0,
  grossMinor: 450_000,
  refundMinor: 50_000,
  lineDiscountMinor: 0,
  saleDiscountMinor: 0,
  loyaltyDiscountMinor: 0,
  loyaltyRedeemPoints: 0,
  loyaltyEarnedPoints: 0,
  baseMinor: 375_000,
  vatMinor: 56_250,
  nhilMinor: 9_375,
  getfundMinor: 9_375,
  taxTotalMinor: 75_000,
  cashMinor: 430_000,
  creditMinor: 0,
  momoMinor: 0,
  cardMinor: 0,
  bankTransferMinor: 0,
  changeMinor: 20_000,
  cashInMinor: 20_000,
  cashOutMinor: 10_000,
  cashRefundsMinor: 50_000,
  cashRepaymentsMinor: 15_000,
}

const IDENTITY = {
  branchCode: 'ACC-SPX',
  branchName: 'Accra Spintex',
  terminalCode: 'ACC-SPX-T01',
}

function report() {
  return localShiftReport(SHIFT, FIGURES, 470_000, '2026-10-27T18:30:00.000Z')
}

describe('reportPrintJob', () => {
  it('carries the document and leaves the lines to the main process', () => {
    const document = closedShiftDocument({
      report: report(),
      identity: IDENTITY,
      cashierName: 'Ama Mensah',
    })
    const job = reportPrintJob(document, DEFAULT_PRINTER_SETTINGS)

    expect(job.report).toBe(document)
    expect(job.lines).toEqual([])
    expect(job.receiptNumber).toBe('ACC-SPX-T01-S-20261027-01')
  })

  it('never opens the cash drawer', () => {
    const job = reportPrintJob(
      closedShiftDocument({ report: report(), identity: IDENTITY, cashierName: 'Ama Mensah' }),
      DEFAULT_PRINTER_SETTINGS,
    )
    expect(job.openDrawer).toBe(false)
  })

  it('prints the cash refund the drawer is short by, from the report payload', () => {
    // The figure is `readShiftFigures`' one cash-refund sum, carried under the
    // report's field name: the till does not add it up a second time.
    expect(report().cashRefundMinor).toBe(FIGURES.cashRefundsMinor)

    const text = reportDocumentText(
      closedShiftDocument({ report: report(), identity: IDENTITY, cashierName: 'Ama Mensah' }),
    )
    const refunds = text.split('\n').find((line) => line.startsWith('Cash refunds'))
    expect(refunds?.endsWith('GHS -500.00')).toBe(true)
  })

  it('names the drawer’s cashier, and the closer only on a takeover', () => {
    const rows = (text: string, label: string): string[] =>
      text
        .split('\n')
        .filter((line) => line.startsWith(label))
        .map((line) => line.trimEnd())

    const cashier = reportDocumentText(
      closedShiftDocument({ report: report(), identity: IDENTITY, cashierName: 'Ama Mensah' }),
    )
    expect(rows(cashier, 'Cashier')[0]?.endsWith('Ama Mensah')).toBe(true)
    expect(cashier).not.toContain('Closed by')

    // The same document with a manager at the drawer: both names, one each.
    const takeover = reportDocumentText(
      closedShiftDocument({
        report: report(),
        identity: IDENTITY,
        cashierName: 'Ama Mensah',
        closedByName: 'Kofi Boateng',
      }),
    )
    expect(rows(takeover, 'Cashier')[0]?.endsWith('Ama Mensah')).toBe(true)
    expect(rows(takeover, 'Closed by')[0]?.endsWith('Kofi Boateng')).toBe(true)
  })
})
