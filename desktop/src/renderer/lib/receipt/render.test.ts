import { describe, expect, it } from 'vitest'
import type { SaleLineRow, SaleRow, SaleTenderRow } from '../sale/sale-repository'
import {
  buildReceiptModel,
  formatReceiptDateTime,
  leftRight,
  type ReceiptModel,
  receiptToText,
  toEscPosLines,
  wrapText,
} from './render'

const SALE: SaleRow = {
  id: '55555555-5555-7555-8555-555555555555',
  receiptNumber: 'ACC-SPX-T01-20261023-0007',
  branchId: 'branch-1',
  terminalId: 'terminal-1',
  deviceId: 'device-1',
  shiftId: 'shift-1',
  clientTransactionId: '55555555-5555-7555-8555-555555555555',
  cashierUserId: 'user-cashier',
  cashierStaffId: 'GA-0003',
  customerId: null,
  occurredAt: '2026-10-23T10:15:00.000Z',
  subtotalMinor: 12_000,
  lineDiscountMinor: 0,
  saleDiscountMinor: 0,
  loyaltyRedeemPoints: 0,
  loyaltyDiscountMinor: 0,
  vatMinor: 1_500,
  nhilMinor: 250,
  getfundMinor: 250,
  taxTotalMinor: 2_000,
  totalMinor: 12_000,
  tenderTotalMinor: 15_000,
  changeMinor: 3_000,
  loyaltyEarnedPoints: 100,
  creditAmountMinor: 0,
  taxMode: 'INCLUSIVE',
  appVersion: '0.1.0',
  printStatus: 'PENDING',
  printedAt: null,
  printError: null,
  reprintCount: 0,
  createdAt: '2026-10-23T10:15:00.000Z',
}

const LINE: SaleLineRow = {
  saleId: SALE.id,
  lineNumber: 1,
  productId: '11111111-1111-7111-8111-111111111111',
  sku: 'GIK-00001',
  name: 'Brake Pad Set',
  barcode: '4006381333931',
  quantity: 2,
  unitPriceMinor: 6_000,
  expectedUnitPriceMinor: 6_000,
  lineDiscountMinor: 0,
  saleDiscountMinor: 0,
  loyaltyDiscountMinor: 0,
  netMinor: 12_000,
  taxableMinor: 10_000,
  baseMinor: 10_000,
  vatMinor: 1_500,
  nhilMinor: 250,
  getfundMinor: 250,
  taxTotalMinor: 2_000,
  totalMinor: 12_000,
  taxCategory: 'STANDARD',
}

const CASH: SaleTenderRow = {
  saleId: SALE.id,
  method: 'CASH',
  amountMinor: 15_000,
  reference: null,
  createdAt: SALE.occurredAt,
}

const CONTEXT = {
  branchName: 'Accra - Spintex',
  branchCode: 'ACC-SPX',
  terminalCode: 'ACC-SPX-T01',
  receiptHeader: 'GikAutos',
  receiptFooter: 'Thank you',
}

function model(overrides: Partial<ReceiptModel> = {}): ReceiptModel {
  return {
    ...buildReceiptModel({ sale: SALE, lines: [LINE], tenders: [CASH], context: CONTEXT }),
    ...overrides,
  }
}

describe('receipt model', () => {
  it('is built from the local sale row and its tender', () => {
    const built = buildReceiptModel({
      sale: SALE,
      lines: [LINE],
      tenders: [CASH],
      context: CONTEXT,
    })

    expect(built.header.receiptNumber).toBe('ACC-SPX-T01-20261023-0007')
    expect(built.header.branch).toBe('Accra - Spintex')
    expect(built.header.reprint).toBe(false)
    expect(built.tender).toEqual({ method: 'CASH', amountMinor: 15_000, changeMinor: 3_000 })
    expect(built.totals.taxableMinor).toBe(10_000)
    expect(built.lines[0]?.totalMinor).toBe(12_000)
  })

  it('describes a zero-total sale without a tender', () => {
    const built = buildReceiptModel({
      sale: {
        ...SALE,
        totalMinor: 0,
        taxTotalMinor: 0,
        vatMinor: 0,
        nhilMinor: 0,
        getfundMinor: 0,
      },
      lines: [
        {
          ...LINE,
          totalMinor: 0,
          baseMinor: 0,
          taxTotalMinor: 0,
          vatMinor: 0,
          nhilMinor: 0,
          getfundMinor: 0,
        },
      ],
      tenders: [],
      context: CONTEXT,
    })
    expect(built.tender.method).toBe('NONE')
    expect(built.totals.totalMinor).toBe(0)
  })

  it('carries the customer and loyalty points when present', () => {
    const built = buildReceiptModel({
      sale: { ...SALE, loyaltyRedeemPoints: 250, loyaltyDiscountMinor: 250 },
      lines: [LINE],
      tenders: [CASH],
      context: CONTEXT,
      customer: { name: 'Akosua Mensah', phone: '+233 20 111 2222' },
    })
    expect(built.header.customer?.name).toBe('Akosua Mensah')
    expect(built.loyalty).toEqual({ earnedPoints: 100, redeemedPoints: 250 })
  })
})

describe('42-column ESC/POS text', () => {
  it('never exceeds the paper width and prints every money field', () => {
    const lines = toEscPosLines(model())
    const text = lines.map((line) => line.text)

    for (const line of text) expect(line.length).toBeLessThanOrEqual(42)
    expect(text.join('\n')).toContain('ACC-SPX-T01-20261023-0007')
    expect(text.join('\n')).toContain('VAT 15%')
    expect(text.join('\n')).toContain('NHIL 2.5%')
    expect(text.join('\n')).toContain('GETFund 2.5%')
    expect(text.join('\n')).toContain('GHS 120.00')
    expect(text.join('\n')).toContain('Cash')
    expect(text.join('\n')).toContain('Change')
  })

  it('marks the total and a reprint in bold', () => {
    const lines = toEscPosLines(model())
    const total = lines.find((line) => line.text.includes('TOTAL'))
    expect(total?.bold).toBe(true)

    const reprint = toEscPosLines(
      buildReceiptModel({
        sale: SALE,
        lines: [LINE],
        tenders: [CASH],
        context: CONTEXT,
        reprint: true,
      }),
    )
    expect(reprint[0]?.text.trim()).toBe('*** REPRINT ***')
    expect(reprint[0]?.bold).toBe(true)
  })

  it('wraps a long product name instead of clipping it', () => {
    const longName =
      'Brake Pad Set — Front Axle, Ceramic Compound With An Extremely Long Description That Must Wrap'
    const lines = toEscPosLines(
      buildReceiptModel({
        sale: SALE,
        lines: [{ ...LINE, name: longName }],
        tenders: [CASH],
        context: CONTEXT,
      }),
    )
    const text = lines.map((line) => line.text)
    expect(text.join('\n')).not.toContain('MustWrap')
    for (const line of text) expect(line.length).toBeLessThanOrEqual(42)
    expect(text.some((line) => line.includes('Brake Pad Set'))).toBe(true)
  })

  it('uses the configured currency symbol and prints no GH₵ by default', () => {
    const ghs = receiptToText(model())
    expect(ghs).toContain('GHS')
    expect(ghs).not.toContain('GH₵')

    const cedi = receiptToText(model(), { currencySymbol: 'GH₵' })
    expect(cedi).toContain('GH₵')
  })

  it('shows no payment due for a zero-total sale', () => {
    const text = toEscPosLines({
      ...model(),
      totals: {
        ...model().totals,
        subtotalMinor: 0,
        taxableMinor: 0,
        vatMinor: 0,
        nhilMinor: 0,
        getfundMinor: 0,
        taxTotalMinor: 0,
        totalMinor: 0,
      },
      lines: [],
      tender: { method: 'NONE', amountMinor: 0, changeMinor: 0 },
      loyalty: null,
    })
      .map((line) => line.text)
      .join('\n')
    expect(text).toContain('No payment due')
    expect(text).toContain('GHS 0.00')
  })

  it('keeps the tax components equal to the stored tax total', () => {
    const built = model()
    expect(built.totals.vatMinor + built.totals.nhilMinor + built.totals.getfundMinor).toBe(
      built.totals.taxTotalMinor,
    )
    expect(built.totals.taxableMinor + built.totals.taxTotalMinor).toBe(built.totals.totalMinor)
  })
})

describe('column helpers', () => {
  it('formats the receipt date in Accra (UTC) time', () => {
    expect(formatReceiptDateTime('2026-10-23T10:15:00.000Z')).toBe('2026-10-23 10:15')
    expect(formatReceiptDateTime('2026-10-23T23:59:00.000Z')).toBe('2026-10-23 23:59')
    expect(formatReceiptDateTime('not-a-date')).toBe('not-a-date')
  })

  it('right-aligns in exactly the column width', () => {
    expect(leftRight('TOTAL', 'GHS 120.00', 42)).toHaveLength(42)
    expect(leftRight('TOTAL', 'GHS 120.00', 42).endsWith('GHS 120.00')).toBe(true)
    expect(leftRight('x'.repeat(80), 'GHS 1.00', 42)).toHaveLength(42)
  })

  it('word-wraps and hard-breaks long tokens', () => {
    expect(wrapText('one two three', 7)).toEqual(['one two', 'three'])
    expect(wrapText('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij'])
    expect(wrapText('', 42)).toEqual([''])
  })
})
