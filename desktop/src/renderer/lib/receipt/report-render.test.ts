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
  cashRefundMinor: 0,
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

    const order = ['Z-REPORT', 'Cashier', 'SALES', 'TAX', 'TENDERS', 'DRAWER', 'VOIDS', 'Signature']
    const positions = order.map((label) => text.indexOf(label))
    for (const [index, position] of positions.entries()) {
      expect(position, `${order[index]} is on the paper`).toBeGreaterThan(-1)
      if (index > 0) expect(position).toBeGreaterThan(positions[index - 1] as number)
    }
  })

  it('names the drawer’s cashier and the manager who closed it, in that order', () => {
    const text = reportDocumentText(
      buildReportDocument(FIGURES, context({ closedByName: 'Kofi Boateng' })),
    )
    const header = rowsOf(text).slice(0, 6)

    expect(header.filter((row) => row.label === 'Cashier')).toEqual([
      { label: 'Cashier', value: 'Ama Mensah' },
    ])
    expect(header.filter((row) => row.label === 'Closed by')).toEqual([
      { label: 'Closed by', value: 'Kofi Boateng' },
    ])
    // The drawer is the cashier's; the count and the signature are the closer's.
    expect(text.indexOf('Cashier')).toBeLessThan(text.indexOf('Closed by'))
    expect(text.indexOf('Closed by')).toBeLessThan(text.indexOf('SALES'))
    expect(rowsOf(text).at(-2)).toEqual({ label: 'Closed by', value: 'Kofi Boateng' })
  })

  it('prints one Cashier line when the cashier closed their own drawer', () => {
    const text = reportDocumentText(buildReportDocument(FIGURES, context()))

    expect(text).not.toContain('Closed by')
    // One line in the header, and the same person signs at the foot.
    expect(rowsOf(text).filter((row) => row.label === 'Cashier')).toEqual([
      { label: 'Cashier', value: 'Ama Mensah' },
      { label: 'Cashier', value: 'Ama Mensah' },
    ])
    expect(rowsOf(text).at(-2)).toEqual({ label: 'Cashier', value: 'Ama Mensah' })
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
    const texts = [
      reportDocumentText(buildReportDocument(FIGURES, context())),
      // A takeover adds a row; it must not push the widest one past the paper.
      reportDocumentText(buildReportDocument(FIGURES, context({ closedByName: 'Kofi Boateng' }))),
    ]
    for (const text of texts) {
      for (const line of text.split('\n')) {
        expect(line.length, JSON.stringify(line)).toBeLessThanOrEqual(REPORT_COLUMNS)
      }
      const rules = text.split('\n').filter((line) => /^-+$/.test(line))
      expect(rules.length).toBeGreaterThan(0)
      for (const rule of rules) expect(rule).toHaveLength(REPORT_COLUMNS)
    }
  })

  it('formats money from integer pesewas without a float round-trip', () => {
    const text = reportDocumentText(
      buildReportDocument({ ...FIGURES, grossMinor: 4_501, netMinor: 4_501 }, context()),
    )
    expect(text).toContain('GHS 45.01')
    expect(text).not.toContain('GHS 45.009999')
  })
})

/**
 * The drawer, read off the paper (P14-D1).
 *
 * The plan's example: a GH₵500 cash refund went out of a drawer that took
 * GH₵4300 and gave GH₵200 back, with a float and a cash-in/out on top. The six
 * lines above `Expected` have to add up to it without a calculator, and the
 * tender block has to print the same cash figure under a different heading.
 */

const DRAWER_FIGURES: ShiftReportFigures = {
  ...FIGURES,
  openingFloatMinor: 100_000,
  cashMinor: 430_000,
  changeMinor: 20_000,
  cashRefundMinor: 50_000,
  cashInMinor: 20_000,
  cashOutMinor: 10_000,
  expectedCashMinor: 470_000,
  countedCashMinor: 470_000,
  varianceMinor: 0,
}

function rowParts(row: string): { label: string; value: string } | null {
  const match = /^(.+?)\s{2,}(\S.*)$/.exec(row.trimEnd())
  const label = match?.[1]?.trim()
  if (!label || !match?.[2]) return null
  return { label, value: match[2] }
}

/** Every printed row, whatever the section; titles and rules are not rows. */
function rowsOf(text: string): { label: string; value: string }[] {
  return text.split('\n').flatMap((row) => rowParts(row) ?? [])
}

function rowValue(text: string, label: string): string | undefined {
  return rowsOf(text).find((row) => row.label === label)?.value
}

function drawerRows(text: string): { label: string; value: string }[] {
  const rows = text.split('\n')
  const start = rows.findIndex((row) => row.trim() === 'DRAWER')
  const after = rows.slice(start + 1)
  const end = after.findIndex((row) => /^-+$/.test(row))
  return (end === -1 ? after : after.slice(0, end)).flatMap((row) => rowParts(row) ?? [])
}

/** `GHS -500.00` → `-50000`, without a float round-trip on paper money. */
function printedMinor(value: string): number {
  const amount = value.replace(/^GH[S₵] /, '')
  const negative = amount.startsWith('-')
  const [whole, fraction] = amount.replace('-', '').split('.')
  const minor = Number(whole) * 100 + Number(fraction ?? 0)
  return negative ? -minor : minor
}

describe('the DRAWER block', () => {
  it('prints the money in the order it moved, and the lines add up', () => {
    const text = reportDocumentText(
      buildReportDocument(DRAWER_FIGURES, context({ varianceLabel: varianceWords(0) })),
    )
    const drawer = drawerRows(text)

    expect(drawer.map((row) => row.label)).toEqual([
      'Opening float',
      'Cash taken',
      'Change given',
      'Cash refunds',
      'Cash in',
      'Cash out',
      'Expected',
      'Counted',
      'Variance',
    ])

    const values = drawer.map((row) => row.value)
    expect(values.slice(0, 6)).toEqual([
      'GHS 1000.00',
      'GHS 4300.00',
      'GHS -200.00',
      'GHS -500.00',
      'GHS 200.00',
      'GHS -100.00',
    ])

    // 1000 + 4300 − 200 − 500 + 200 − 100 = 4700, which is the row below it.
    const sum = values.slice(0, 6).reduce((total, value) => total + printedMinor(value), 0)
    expect(sum).toBe(printedMinor(values[6] as string))
    expect(values[6]).toBe('GHS 4700.00')
    // A drawer counted at the formula disagrees by nothing.
    expect(values[8]).toBe(varianceWords(0))
  })

  it('prints one cash figure for both TENDERS and DRAWER', () => {
    const text = reportDocumentText(buildReportDocument(DRAWER_FIGURES, context()))
    const tendersCash = rowValue(text, 'Cash')
    const taken = drawerRows(text).find((row) => row.label === 'Cash taken')

    expect(tendersCash).toBe('GHS 4300.00')
    // Same field, same number: a manager comparing the two finds them equal,
    // and neither line is a second summation that can drift.
    expect(taken?.value).toBe(tendersCash)
  })

  it('says the cash refund was never itemised rather than printing a zero', () => {
    const text = reportDocumentText(
      buildReportDocument({ ...DRAWER_FIGURES, cashRefundMinor: null }, context()),
    )
    const refunds = drawerRows(text).find((row) => row.label === 'Cash refunds')

    // A snapshot that did not measure the refund cannot claim it was nothing.
    expect(refunds?.value).toBe('not itemised')
    expect(refunds?.value).not.toContain('-')
  })
})
