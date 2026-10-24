import { formatAccraDateTime } from '@sceptre/shared'
import type { PrintLine } from '../../../shared/printing'
import { formatMinorWithSymbol } from '../format'
import type { SaleLineRow, SaleRow, SaleTenderRow } from '../sale/sale-repository'

/**
 * The receipt model (D27).
 *
 * One model feeds both the on-screen preview and the ESC/POS text, so paper and
 * screen cannot disagree about a money field. It is built from the **local sale
 * row**, not from a server response: the receipt must exist the instant a sale
 * commits, offline.
 *
 * E-VAT fields are present but empty until Phase 8 (GRA onboarding); rendering
 * them is out of scope for this phase.
 */

export const RECEIPT_COLUMNS = 42

export interface ReceiptCustomer {
  name?: string | undefined
  phone?: string | undefined
}

export interface ReceiptContext {
  branchName: string
  branchCode: string
  terminalCode: string
  /** Seller identity from `pos.receiptHeader`; may be empty. */
  receiptHeader?: string | undefined
  receiptFooter?: string | undefined
}

export interface ReceiptLine {
  lineNumber: number
  name: string
  quantity: number
  unitPriceMinor: number
  lineDiscountMinor: number
  saleDiscountMinor: number
  loyaltyDiscountMinor: number
  baseMinor: number
  taxMinor: number
  totalMinor: number
  taxCategory: string
}

export interface ReceiptModel {
  header: {
    seller: string
    branch: string
    branchCode: string
    terminal: string
    receiptNumber: string
    occurredAt: string
    cashier: string
    customer: ReceiptCustomer | null
    reprint: boolean
  }
  lines: ReceiptLine[]
  totals: {
    subtotalMinor: number
    lineDiscountMinor: number
    saleDiscountMinor: number
    loyaltyDiscountMinor: number
    taxableMinor: number
    vatMinor: number
    nhilMinor: number
    getfundMinor: number
    taxTotalMinor: number
    totalMinor: number
  }
  tender: {
    method: 'CASH' | 'CREDIT' | 'NONE'
    amountMinor: number
    changeMinor: number
  }
  loyalty: {
    earnedPoints: number
    redeemedPoints: number
  } | null
  footer: string
  /** Reserved for Phase 8 E-VAT; always null in Phase 6. */
  evatSerial: string | null
  qrPayload: string | null
  signature: string | null
}

export interface BuildReceiptInput {
  sale: SaleRow
  lines: SaleLineRow[]
  tenders: SaleTenderRow[]
  context: ReceiptContext
  cashierName?: string | null
  customer?: ReceiptCustomer | null
  reprint?: boolean
}

export function buildReceiptModel(input: BuildReceiptInput): ReceiptModel {
  const { sale, lines, tenders, context } = input
  const tender = tenders[0]
  const method: ReceiptModel['tender']['method'] = tender
    ? tender.method
    : sale.totalMinor === 0
      ? 'NONE'
      : 'CASH'

  return {
    header: {
      seller: context.receiptHeader?.trim() || 'Sceptre Drive',
      branch: context.branchName,
      branchCode: context.branchCode,
      terminal: context.terminalCode,
      receiptNumber: sale.receiptNumber,
      occurredAt: sale.occurredAt,
      cashier: input.cashierName || sale.cashierStaffId,
      customer: input.customer ?? null,
      reprint: Boolean(input.reprint),
    },
    lines: [...lines]
      .sort((left, right) => left.lineNumber - right.lineNumber)
      .map((line) => ({
        lineNumber: line.lineNumber,
        name: line.name,
        quantity: line.quantity,
        unitPriceMinor: line.unitPriceMinor,
        lineDiscountMinor: line.lineDiscountMinor,
        saleDiscountMinor: line.saleDiscountMinor,
        loyaltyDiscountMinor: line.loyaltyDiscountMinor,
        baseMinor: line.baseMinor,
        taxMinor: line.taxTotalMinor,
        totalMinor: line.totalMinor,
        taxCategory: line.taxCategory,
      })),
    totals: {
      subtotalMinor: sale.subtotalMinor,
      lineDiscountMinor: sale.lineDiscountMinor,
      saleDiscountMinor: sale.saleDiscountMinor,
      loyaltyDiscountMinor: sale.loyaltyDiscountMinor,
      taxableMinor: sale.totalMinor - sale.taxTotalMinor,
      vatMinor: sale.vatMinor,
      nhilMinor: sale.nhilMinor,
      getfundMinor: sale.getfundMinor,
      taxTotalMinor: sale.taxTotalMinor,
      totalMinor: sale.totalMinor,
    },
    tender: {
      method,
      amountMinor: tender?.amountMinor ?? 0,
      changeMinor: sale.changeMinor,
    },
    loyalty:
      input.customer && (sale.loyaltyEarnedPoints > 0 || sale.loyaltyRedeemPoints > 0)
        ? {
            earnedPoints: sale.loyaltyEarnedPoints,
            redeemedPoints: sale.loyaltyRedeemPoints,
          }
        : null,
    footer: context.receiptFooter ?? '',
    evatSerial: null,
    qrPayload: null,
    signature: null,
  }
}

/** Wraps by words, hard-breaking a token that is longer than the column width. */
export function wrapText(text: string, width = RECEIPT_COLUMNS): string[] {
  if (width < 1) return [text]
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return ['']

  const lines: string[] = []
  let current = ''

  for (const word of words) {
    if (word.length > width) {
      if (current) {
        lines.push(current)
        current = ''
      }
      for (let index = 0; index < word.length; index += width) {
        lines.push(word.slice(index, index + width))
      }
      continue
    }
    if (!current) {
      current = word
    } else if (current.length + 1 + word.length <= width) {
      current = `${current} ${word}`
    } else {
      lines.push(current)
      current = word
    }
  }
  if (current) lines.push(current)
  return lines
}

function center(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width)
  return `${' '.repeat(Math.floor((width - text.length) / 2))}${text}`
}

function truncate(text: string, width: number): string {
  return text.length <= width ? text : text.slice(0, Math.max(0, width))
}

/** `left … right` padded to exactly `width` columns (at least one space). */
export function leftRight(left: string, right: string, width = RECEIPT_COLUMNS): string {
  const gap = width - right.length - 1
  const safeLeft = truncate(left, Math.max(0, gap))
  const padding = Math.max(1, width - safeLeft.length - right.length)
  return `${safeLeft}${' '.repeat(padding)}${right}`
}

export interface RenderOptions {
  columns?: number
  /** `GHS` by default: most ESC/POS charsets cannot render `GH₵`. */
  currencySymbol?: string
}

/**
 * The printed text, already padded to the paper width.
 *
 * Line width is enforced here rather than by the printer: a long product name
 * wraps instead of being clipped by the hardware.
 */
export function toEscPosLines(model: ReceiptModel, options: RenderOptions = {}): PrintLine[] {
  const columns = options.columns ?? RECEIPT_COLUMNS
  const symbol = options.currencySymbol ?? 'GHS'
  const money = (minor: number) => formatMinorWithSymbol(minor, symbol)
  const divider = '-'.repeat(columns)
  const rows: PrintLine[] = []

  const centerRow = (text: string, bold = false) => {
    for (const line of wrapText(text, columns)) rows.push({ text: center(line, columns), bold })
  }
  const pair = (label: string, value: string, bold = false) => {
    rows.push({ text: leftRight(label, value, columns), bold })
  }

  if (model.header.reprint) {
    centerRow('*** REPRINT ***', true)
    rows.push({ text: divider })
  }

  centerRow(model.header.seller, true)
  centerRow(model.header.branch)
  centerRow(`${model.header.branchCode} - ${model.header.terminal}`)
  rows.push({ text: divider })
  centerRow(`RECEIPT ${model.header.receiptNumber}`, true)
  pair('Date', formatAccraDateTime(model.header.occurredAt))
  pair('Cashier', model.header.cashier)
  if (model.header.customer?.name) pair('Customer', model.header.customer.name)
  if (model.header.customer?.phone) pair('Phone', model.header.customer.phone)
  rows.push({ text: divider })

  for (const line of model.lines) {
    for (const nameLine of wrapText(line.name, columns)) {
      rows.push({ text: truncate(nameLine, columns) })
    }
    pair(
      `  ${line.quantity} x ${money(line.unitPriceMinor)}`,
      money(line.unitPriceMinor * line.quantity),
    )
    if (line.lineDiscountMinor > 0) {
      pair('  Line discount', `-${money(line.lineDiscountMinor)}`)
    }
    if (line.saleDiscountMinor > 0) {
      pair('  Sale discount', `-${money(line.saleDiscountMinor)}`)
    }
    if (line.loyaltyDiscountMinor > 0) {
      pair('  Loyalty', `-${money(line.loyaltyDiscountMinor)}`)
    }
    if (line.baseMinor !== line.totalMinor) {
      const rate = line.taxCategory === 'STANDARD' ? '20%' : line.taxCategory
      pair(`  Tax (${rate})`, money(line.taxMinor))
    }
  }

  rows.push({ text: divider })
  pair('Subtotal', money(model.totals.subtotalMinor))
  if (model.totals.lineDiscountMinor > 0) {
    pair('Line discounts', `-${money(model.totals.lineDiscountMinor)}`)
  }
  if (model.totals.saleDiscountMinor > 0) {
    pair('Sale discount', `-${money(model.totals.saleDiscountMinor)}`)
  }
  if (model.totals.loyaltyDiscountMinor > 0) {
    pair(
      model.loyalty ? `Loyalty (${model.loyalty.redeemedPoints} pts)` : 'Loyalty',
      `-${money(model.totals.loyaltyDiscountMinor)}`,
    )
  }
  pair('Taxable base', money(model.totals.taxableMinor))
  if (model.totals.vatMinor !== 0) pair('VAT 15%', money(model.totals.vatMinor))
  if (model.totals.nhilMinor !== 0) pair('NHIL 2.5%', money(model.totals.nhilMinor))
  if (model.totals.getfundMinor !== 0) {
    pair('GETFund 2.5%', money(model.totals.getfundMinor))
  }
  pair('TOTAL', money(model.totals.totalMinor), true)
  rows.push({ text: divider })

  if (model.tender.method === 'NONE') {
    pair('Payment', 'No payment due')
  } else if (model.tender.method === 'CASH') {
    pair('Cash', money(model.tender.amountMinor))
    pair('Change', money(model.tender.changeMinor))
  } else {
    pair('Credit', money(model.tender.amountMinor))
  }

  if (model.loyalty) {
    if (model.loyalty.earnedPoints > 0) {
      pair('Points earned', String(model.loyalty.earnedPoints))
    }
    if (model.loyalty.redeemedPoints > 0) {
      pair('Points redeemed', String(model.loyalty.redeemedPoints))
    }
  }

  if (model.footer.trim()) {
    rows.push({ text: divider })
    for (const footerLine of wrapText(model.footer, columns)) rows.push({ text: footerLine })
  }

  return rows
}

/** The same model as a single plain-text receipt (fake adapter / clipboard). */
export function receiptToText(model: ReceiptModel, options?: RenderOptions): string {
  return toEscPosLines(model, options)
    .map((line) => line.text)
    .join('\n')
}
