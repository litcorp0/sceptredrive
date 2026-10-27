import {
  formatAccraDateTime,
  formatTenderLabel,
  REFUND_REASON_LABELS,
  REFUND_RESTOCK_LABELS,
  type RefundReason,
  type RefundRestock,
  type TenderMethod,
} from '@sceptre/shared'
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
 * The payment block is an ordered tender set since Phase 13 (P13-D1): one line
 * per tender, then the total paid and the change when the sale was split. A
 * single cash sale still prints the two lines it always printed.
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

export interface ReceiptTenderLine {
  method: TenderMethod
  amountMinor: number
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
  /**
   * The tenders in the order the customer paid (P13-D1). A single cash sale
   * prints exactly one `Cash` line, as it always has; the split adds lines, not
   * a different document.
   */
  tenders: ReceiptTenderLine[]
  /** `Σ tenders`, printed only when there is more than one. */
  tenderedMinor: number
  /** Change produced by cash alone (P13-D3). */
  changeMinor: number
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
  const ordered = [...tenders].sort((left, right) => left.sequence - right.sequence)
  const receiptTenders: ReceiptTenderLine[] = ordered.map((tender) => ({
    method: tender.method,
    amountMinor: tender.amountMinor,
  }))

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
    tenders: receiptTenders,
    tenderedMinor: receiptTenders.reduce((sum, tender) => sum + tender.amountMinor, 0),
    changeMinor: sale.changeMinor,
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

  if (model.tenders.length === 0) {
    if (model.totals.totalMinor === 0) pair('Payment', 'No payment due')
  } else {
    for (const tender of model.tenders) {
      pair(formatTenderLabel(tender.method), money(tender.amountMinor))
    }
    // A total-paid line only earns its space when the payment was split; a
    // single cash sale already prints the amount it took and the change.
    if (model.tenders.length > 1) pair('Tendered', money(model.tenderedMinor))
    if (model.changeMinor > 0 || model.tenders.some((tender) => tender.method === 'CASH')) {
      pair('Change', money(model.changeMinor))
    }
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

// --- Refund receipt (P13-D17, Plan 10) ---------------------------------------

/**
 * A refund is its own paper trail, so it gets its own model: `*** REFUND ***`,
 * the original receipt it reverses, each line with its restock decision, and
 * each tender with the status the money is actually in. A card or MoMo refund
 * is `pending` until the provider settles it (P13-D26) — the receipt must not
 * claim otherwise.
 *
 * E-VAT slots stay null, exactly as on a sale, until GRA onboarding.
 */
export interface RefundReceiptLine {
  name: string
  quantity: number
  restock: RefundRestock
  totalMinor: number
}

export interface RefundReceiptTender {
  method: TenderMethod
  amountMinor: number
  status: 'SETTLED' | 'PENDING'
}

export interface RefundReceiptModel {
  header: {
    seller: string
    branch: string
    branchCode: string
    terminal: string
    refundNumber: string
    originalReceiptNumber: string
    occurredAt: string
    cashier: string
    /** The manager whose PIN authorised the refund. */
    manager: string
    reprint: boolean
  }
  reason: {
    code: RefundReason
    label: string
    note: string | null
  }
  lines: RefundReceiptLine[]
  tenders: RefundReceiptTender[]
  totals: {
    baseMinor: number
    vatMinor: number
    nhilMinor: number
    getfundMinor: number
    taxTotalMinor: number
    totalMinor: number
  }
  footer: string
  evatSerial: string | null
  qrPayload: string | null
  signature: string | null
}

export interface BuildRefundReceiptInput {
  context: ReceiptContext
  refundNumber: string
  originalReceiptNumber: string
  occurredAt: string
  cashierName?: string | null
  managerStaffId: string
  reasonCode: RefundReason
  note?: string | null
  lines: RefundReceiptLine[]
  tenders: RefundReceiptTender[]
  totals: RefundReceiptModel['totals']
  reprint?: boolean
}

export function buildRefundReceiptModel(input: BuildRefundReceiptInput): RefundReceiptModel {
  const { context } = input
  return {
    header: {
      seller: context.receiptHeader?.trim() || 'Sceptre Drive',
      branch: context.branchName,
      branchCode: context.branchCode,
      terminal: context.terminalCode,
      refundNumber: input.refundNumber,
      originalReceiptNumber: input.originalReceiptNumber,
      occurredAt: input.occurredAt,
      cashier: input.cashierName || 'Cashier',
      manager: input.managerStaffId,
      reprint: Boolean(input.reprint),
    },
    reason: {
      code: input.reasonCode,
      label: REFUND_REASON_LABELS[input.reasonCode],
      note: input.note?.trim() || null,
    },
    lines: [...input.lines],
    tenders: [...input.tenders],
    totals: input.totals,
    footer: context.receiptFooter ?? '',
    evatSerial: null,
    qrPayload: null,
    signature: null,
  }
}

/** What the paper says each tender's money is doing right now. */
export function refundTenderStatusLabel(
  method: TenderMethod,
  status: RefundReceiptTender['status'],
): string {
  if (status === 'PENDING') return `${formatTenderLabel(method)} · pending`
  if (method === 'CREDIT') return 'Credit · reduced'
  return `${formatTenderLabel(method)} · settled`
}

export function refundToEscPosLines(
  model: RefundReceiptModel,
  options: RenderOptions = {},
): PrintLine[] {
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
  centerRow('*** REFUND ***', true)
  centerRow(`REFUND ${model.header.refundNumber}`, true)
  pair('Date', formatAccraDateTime(model.header.occurredAt))
  pair('Original receipt', model.header.originalReceiptNumber)
  pair('Cashier', model.header.cashier)
  pair('Approved by', model.header.manager)
  rows.push({ text: divider })

  pair('Reason', model.reason.label)
  if (model.reason.note) {
    for (const noteLine of wrapText(model.reason.note, columns)) {
      rows.push({ text: `  ${truncate(noteLine, columns - 2)}` })
    }
  }
  rows.push({ text: divider })

  for (const line of model.lines) {
    for (const nameLine of wrapText(line.name, columns)) {
      rows.push({ text: truncate(nameLine, columns) })
    }
    pair(`  ${line.quantity} · ${REFUND_RESTOCK_LABELS[line.restock]}`, money(line.totalMinor))
  }

  rows.push({ text: divider })
  pair('Taxable base', money(model.totals.baseMinor))
  if (model.totals.vatMinor !== 0) pair('VAT 15%', money(model.totals.vatMinor))
  if (model.totals.nhilMinor !== 0) pair('NHIL 2.5%', money(model.totals.nhilMinor))
  if (model.totals.getfundMinor !== 0) pair('GETFund 2.5%', money(model.totals.getfundMinor))
  pair('TOTAL REFUNDED', money(model.totals.totalMinor), true)
  rows.push({ text: divider })

  for (const tender of model.tenders) {
    pair(refundTenderStatusLabel(tender.method, tender.status), money(tender.amountMinor))
  }

  if (model.footer.trim()) {
    rows.push({ text: divider })
    for (const footerLine of wrapText(model.footer, columns)) rows.push({ text: footerLine })
  }

  return rows
}

export function refundReceiptToText(model: RefundReceiptModel, options?: RenderOptions): string {
  return refundToEscPosLines(model, options)
    .map((line) => line.text)
    .join('\n')
}

// --- Repayment receipt (P13-D27, Plan 10) -------------------------------------

/** A credit repayment's own paper trail, from the till's local copy. */
export interface RepaymentReceiptModel {
  header: {
    seller: string
    branch: string
    branchCode: string
    terminal: string
    number: string
    occurredAt: string
    cashier: string
    customer: string
    phone: string | null
  }
  method: 'CASH' | 'MOMO'
  amountMinor: number
  account: {
    balanceBeforeMinor: number
    balanceAfterMinor: number
    limitMinor: number
    headroomMinor: number
  }
  footer: string
  evatSerial: string | null
}

export interface BuildRepaymentReceiptInput {
  context: ReceiptContext
  number: string
  occurredAt: string
  cashierName?: string | null
  customerName: string
  customerPhone?: string | null
  method: 'CASH' | 'MOMO'
  amountMinor: number
  balanceBeforeMinor: number
  balanceAfterMinor: number
  limitMinor: number
  headroomMinor: number
}

export function buildRepaymentReceiptModel(
  input: BuildRepaymentReceiptInput,
): RepaymentReceiptModel {
  return {
    header: {
      seller: input.context.receiptHeader?.trim() || 'Sceptre Drive',
      branch: input.context.branchName,
      branchCode: input.context.branchCode,
      terminal: input.context.terminalCode,
      number: input.number,
      occurredAt: input.occurredAt,
      cashier: input.cashierName || 'Cashier',
      customer: input.customerName,
      phone: input.customerPhone ?? null,
    },
    method: input.method,
    amountMinor: input.amountMinor,
    account: {
      balanceBeforeMinor: input.balanceBeforeMinor,
      balanceAfterMinor: input.balanceAfterMinor,
      limitMinor: input.limitMinor,
      headroomMinor: input.headroomMinor,
    },
    footer: input.context.receiptFooter ?? '',
    evatSerial: null,
  }
}

export function repaymentToEscPosLines(
  model: RepaymentReceiptModel,
  options: RenderOptions = {},
): PrintLine[] {
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

  centerRow(model.header.seller, true)
  centerRow(model.header.branch)
  centerRow(`${model.header.branchCode} - ${model.header.terminal}`)
  rows.push({ text: divider })
  centerRow('*** CREDIT REPAYMENT ***', true)
  centerRow(`RECEIPT ${model.header.number}`, true)
  pair('Date', formatAccraDateTime(model.header.occurredAt))
  pair('Cashier', model.header.cashier)
  pair('Customer', model.header.customer)
  if (model.header.phone) pair('Phone', model.header.phone)
  rows.push({ text: divider })

  pair(model.method === 'CASH' ? 'Cash received' : 'MoMo received', money(model.amountMinor), true)
  rows.push({ text: divider })
  pair('Balance before', money(model.account.balanceBeforeMinor))
  pair('Balance after', money(model.account.balanceAfterMinor), true)
  if (model.account.limitMinor > 0) pair('Credit limit', money(model.account.limitMinor))
  pair('Available', money(model.account.headroomMinor))

  if (model.footer.trim()) {
    rows.push({ text: divider })
    for (const footerLine of wrapText(model.footer, columns)) rows.push({ text: footerLine })
  }

  return rows
}

export function repaymentReceiptToText(
  model: RepaymentReceiptModel,
  options?: RenderOptions,
): string {
  return repaymentToEscPosLines(model, options)
    .map((line) => line.text)
    .join('\n')
}
