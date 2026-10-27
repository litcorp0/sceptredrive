import { describe, expect, it } from 'vitest'
import { varianceWords } from '../../modules/shift/utils/variance'
import {
  buildReportDocument,
  REPORT_COLUMNS,
  type ReportDocumentContext,
  reportDocumentText,
  type ShiftReportFigures,
} from './report-render'

/**
 * The report document (P13-D34).
 *
 * The paper is the contract: sections in a fixed order, money in integer
 * pesewas rendered by `formatMinorPlain`, the variance in the same words the
 * close dialog uses, and an X that says it stored nothing.
 */

const FIGURES: ShiftReportFigures = {
  openingFloatMinor: 20_000,
  saleCount: 3,
  itemCount: 7,
  refundCount: 1,
  voidCount: 2,
  grossMinor: 45_000,
  refundMinor: 5_000,
  netMinor: 40_000,
  lineDiscountMinor: 0,
  saleDiscountMinor: 1_000,
  loyaltyDiscountMinor: 500,
  loyaltyRedeemPoints: 100,
  loyaltyEarnedPoints: 30,
  baseMinor: 36_250,
  vatMinor: 5_437,
  nhilMinor: 906,
  getfundMinor: 906,
  taxTotalMinor: 7_249,
  cashMinor: 30_000,
  creditMinor: 5_000,
  momoMinor: 10_000,
  cardMinor: 0,
  bankTransferMinor: 0,
  changeMinor: 2_000,
  cashInMinor: 5_000,
  cashOutMinor: 1_000,
  expectedCashMinor: 52_000,
  countedCashMinor: 51_500,
  varianceMinor: -500,
}

function context(overrides: Partial<ReportDocumentContext> = {}): ReportDocumentContext {
  return {
    kind: 'Z',
    seller: 'Sceptre Drive',
    branchName: 'Accra Spintex',
    branchCode: 'ACC-SPX',
    terminalCode: 'ACC-SPX-T01',
    shiftNumber: 'ACC-SPX-T01-S-20261027-01',
    openedAt: '2026-10-27T08:00:00.000Z',
    closedAt: '2026-10-27T18:30:00.000Z',
    cashierName: 'Ama Mensah',
    generatedAt: '2026-10-27T18:30:00.000Z',
    varianceLabel: varianceWords(-500),
    ...overrides,
  }
}

describe('buildReportDocument', () => {
  it('prints every section of a Z, in order', () => {
    const document = buildReportDocument(FIGURES, context())
    const text = reportDocumentText(document)

    expect(document.title).toBe('Z-REPORT')
    expect(document.reference).toBe('ACC-SPX-T01-S-20261027-01')

    const order = ['Z-REPORT', 'SALES', 'TAX', 'TENDERS', 'DRAWER', 'VOIDS', 'Signature']
    const positions = order.map((label) => text.indexOf(label))
    for (const [index, position] of positions.entries()) {
      expect(position, `${order[index]} is on the paper`).toBeGreaterThan(-1)
      if (index > 0) expect(position).toBeGreaterThan(positions[index - 1] as number)
    }
  })

  it('carries the tender breakdown and the tax split', () => {
    const text = reportDocumentText(buildReportDocument(FIGURES, context()))

    expect(text).toContain('GHS 300.00') // cash
    expect(text).toContain('GHS 50.00') // credit
    expect(text).toContain('GHS 100.00') // MoMo
    expect(text).toContain('GHS 20.00') // change given
    expect(text).toContain('GHS 362.50') // taxable base
    expect(text).toContain('GHS 54.37') // VAT 15%
    expect(text).toContain('GHS 9.06') // NHIL / GETFund
    expect(text).toContain('GHS 72.49') // tax total
    expect(text).toContain('GHS 50.00') // refunds
  })

  it('says the variance in the words the close dialog uses', () => {
    const text = reportDocumentText(buildReportDocument(FIGURES, context()))
    const varianceRow = text.split('\n').find((line) => line.startsWith('Variance'))
    expect(varianceRow?.endsWith(varianceWords(-500))).toBe(true)
  })

  it('marks a reprint as one', () => {
    const text = reportDocumentText(buildReportDocument(FIGURES, context({ reprint: true })))
    expect(text.trimStart().startsWith('*** REPRINT ***')).toBe(true)
  })

  it('prints an X that stores nothing and closes nothing', () => {
    const text = reportDocumentText(
      buildReportDocument(
        { ...FIGURES, countedCashMinor: null, varianceMinor: null },
        context({ kind: 'X', closedAt: null }),
      ),
    )
    expect(text).toContain('X-REPORT')
    expect(text).toContain('Not stored, not a close')
    expect(text).not.toContain('Stored at close')
    // An X over an open drawer has no counted figure to claim.
    expect(text).toContain('not counted')
  })

  it('lays every row out inside 42 columns, with a full-width rule', () => {
    const text = reportDocumentText(buildReportDocument(FIGURES, context()))
    for (const line of text.split('\n')) {
      expect(line.length, JSON.stringify(line)).toBeLessThanOrEqual(REPORT_COLUMNS)
    }
    const rules = text.split('\n').filter((line) => /^-+$/.test(line))
    expect(rules.length).toBeGreaterThan(0)
    for (const rule of rules) expect(rule).toHaveLength(REPORT_COLUMNS)
  })

  it('formats money from integer pesewas without a float round-trip', () => {
    const text = reportDocumentText(
      buildReportDocument({ ...FIGURES, grossMinor: 4_501, netMinor: 4_501 }, context()),
    )
    expect(text).toContain('GHS 45.01')
    expect(text).not.toContain('GHS 45.009999')
  })
})
