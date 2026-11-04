import { formatAccraDateTime, formatBranchLabel } from '@sceptre/shared'
import type { ReportDocument, ReportLine } from '../../../shared/printing'
import { formatMinorPlain } from '../format'

/**
 * The shift report document (P13-D34).
 *
 * One builder feeds the Z (printed at close from the local snapshot) and the X
 * (computed live, never stored). It is pure: every figure arrives already
 * summed by `readShiftFigures`, and every amount is an integer in pesewas
 * formatted with `formatMinorPlain` — no float ever touches paper money.
 *
 * The output is a list of *roles* (`title`, `row`, `rule`, `total`), not text.
 * The main process pads the columns, so the printed document cannot drift from
 * the preview and the printer contract never learns a business term.
 */

export const REPORT_COLUMNS = 42

/** The frozen figures a report prints, in the server's field-for-field shape. */
export interface ShiftReportFigures {
  openingFloatMinor: number
  saleCount: number
  itemCount: number
  refundCount: number
  voidCount: number
  grossMinor: number
  refundMinor: number
  netMinor: number
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
  /**
   * Settled cash refunds: money that physically left this drawer, and the
   * figure the expected-cash formula already subtracts.
   *
   * It arrives from the report payload (on the till, `readShiftFigures`; on the
   * server, `shift_report.cash_refund_minor`) and is never re-summed here — two
   * summations of the same refunds eventually disagree. Null means the snapshot
   * never measured it (a Z stored before the column existed), which the paper
   * says out loud instead of printing a zero it cannot prove.
   */
  cashRefundMinor: number | null
  /**
   * Cash taken against credit over this counter (P20-D1), the other figure the
   * expected-cash sum already adds. It is a drawer movement, not a sale: the
   * debt it settles was rung up in an earlier shift, so it appears here and
   * never in the sales lines above.
   *
   * Null means the snapshot never measured it (a Z stored before the till
   * attributed repayments to a drawer). The paper says so rather than printing
   * a zero it cannot prove.
   */
  cashRepaymentMinor: number | null
  cashInMinor: number
  cashOutMinor: number
  expectedCashMinor: number
  /** Null on an X for a drawer nobody has counted. */
  countedCashMinor: number | null
  varianceMinor: number | null
}

export interface ReportDocumentContext {
  kind: 'X' | 'Z'
  /** `pos.receiptHeader`, or the product name when the branch has none. */
  seller: string
  branchName: string
  branchCode: string
  terminalCode: string
  shiftNumber: string
  openedAt: string
  closedAt: string | null
  /** The shift's cashier: whose drawer this is, not who is holding the pen. */
  cashierName: string
  /**
   * The person who closed the drawer, when that is somebody else — a manager
   * taking the count over at shift end (P14-D12). The caller compares staff
   * identities, not names, and passes `null` when they are the same person, so
   * an ordinary close prints one `Cashier` line and no duplication.
   */
  closedByName?: string | null | undefined
  /** When this document was produced; for a Z that is the close. */
  generatedAt: string
  /**
   * `varianceWords()` from the shift screen. The wording lives there because
   * the close dialog owns it; a report must say the same sentence.
   */
  varianceLabel: string
  /** `GHS` unless the configured charset can render `GH₵`. */
  currencySymbol?: string | undefined
  /** Adds the reprint band, because a second copy is a second copy. */
  reprint?: boolean | undefined
}

function money(minor: number, symbol: string): string {
  return `${symbol} ${formatMinorPlain(minor)}`
}

function center(text: string, width = REPORT_COLUMNS): string {
  if (text.length >= width) return text.slice(0, width)
  return `${' '.repeat(Math.floor((width - text.length) / 2))}${text}`
}

function padLabel(label: string, value: string, width = REPORT_COLUMNS): string {
  const safeRight = value.length > width ? value.slice(0, width) : value
  const gap = width - safeRight.length - 1
  const safeLeft = label.length > gap ? label.slice(0, Math.max(0, gap)) : label
  return `${safeLeft}${' '.repeat(Math.max(1, width - safeLeft.length - safeRight.length))}${safeRight}`
}

/**
 * The document, section by section: header, shift, sales, tax, tenders, drawer,
 * voids, then the provenance line and a signature.
 *
 * Sections are always present even at zero, because "Refunds 0" on paper is an
 * assertion a manager can rely on, while a missing section is a question.
 */
export function buildReportDocument(
  figures: ShiftReportFigures,
  context: ReportDocumentContext,
): ReportDocument {
  const symbol = context.currencySymbol ?? 'GHS'
  const amount = (minor: number) => money(minor, symbol)
  const kind = context.kind
  const lines: ReportLine[] = []

  if (context.reprint) {
    lines.push({ kind: 'title', label: '*** REPRINT ***' })
    lines.push({ kind: 'rule' })
  }

  lines.push({ kind: 'title', label: context.seller })
  lines.push({
    kind: 'title',
    label: formatBranchLabel({ name: context.branchName, code: context.branchCode }),
  })
  lines.push({ kind: 'title', label: context.terminalCode })
  lines.push({ kind: 'rule' })
  lines.push({ kind: 'title', label: kind === 'Z' ? 'Z-REPORT' : 'X-REPORT' })
  lines.push({ kind: 'title', label: context.shiftNumber })
  lines.push({ kind: 'row', label: 'Opened', value: formatAccraDateTime(context.openedAt) })
  if (kind === 'Z' && context.closedAt) {
    lines.push({ kind: 'row', label: 'Closed', value: formatAccraDateTime(context.closedAt) })
  } else {
    lines.push({
      kind: 'row',
      label: 'Generated',
      value: formatAccraDateTime(context.generatedAt),
    })
  }
  lines.push({ kind: 'row', label: 'Cashier', value: context.cashierName })
  // Only a takeover says so: the drawer belongs to the cashier, the count and
  // the signature belong to whoever closed it.
  if (context.closedByName) {
    lines.push({ kind: 'row', label: 'Closed by', value: context.closedByName })
  }

  lines.push({ kind: 'rule' })
  lines.push({ kind: 'title', label: 'SALES' })
  lines.push({ kind: 'row', label: 'Sales', value: String(figures.saleCount) })
  lines.push({ kind: 'row', label: 'Items', value: String(figures.itemCount) })
  lines.push({ kind: 'row', label: 'Gross', value: amount(figures.grossMinor) })
  lines.push({
    kind: 'row',
    label: 'Line discounts',
    value: `-${amount(figures.lineDiscountMinor)}`,
  })
  lines.push({
    kind: 'row',
    label: 'Sale discounts',
    value: `-${amount(figures.saleDiscountMinor)}`,
  })
  lines.push({
    kind: 'row',
    label: 'Loyalty redeemed',
    value: `-${amount(figures.loyaltyDiscountMinor)}`,
  })
  lines.push({
    kind: 'row',
    label: 'Points earned',
    value: String(figures.loyaltyEarnedPoints),
  })
  lines.push({
    kind: 'row',
    label: 'Points redeemed',
    value: String(figures.loyaltyRedeemPoints),
  })
  lines.push({
    kind: 'row',
    label: `Refunds (${figures.refundCount})`,
    value: `-${amount(figures.refundMinor)}`,
  })
  lines.push({ kind: 'total', label: 'NET', value: amount(figures.netMinor) })

  lines.push({ kind: 'rule' })
  lines.push({ kind: 'title', label: 'TAX' })
  lines.push({ kind: 'row', label: 'Taxable base', value: amount(figures.baseMinor) })
  lines.push({ kind: 'row', label: 'VAT 15%', value: amount(figures.vatMinor) })
  lines.push({ kind: 'row', label: 'NHIL 2.5%', value: amount(figures.nhilMinor) })
  lines.push({ kind: 'row', label: 'GETFund 2.5%', value: amount(figures.getfundMinor) })
  lines.push({ kind: 'total', label: 'Tax total', value: amount(figures.taxTotalMinor) })

  lines.push({ kind: 'rule' })
  lines.push({ kind: 'title', label: 'TENDERS' })
  lines.push({ kind: 'row', label: 'Cash', value: amount(figures.cashMinor) })
  lines.push({ kind: 'row', label: 'Credit', value: amount(figures.creditMinor) })
  lines.push({ kind: 'row', label: 'MoMo', value: amount(figures.momoMinor) })
  lines.push({ kind: 'row', label: 'Card', value: amount(figures.cardMinor) })
  lines.push({ kind: 'row', label: 'Bank transfer', value: amount(figures.bankTransferMinor) })
  lines.push({ kind: 'row', label: 'Change given', value: amount(figures.changeMinor) })
  lines.push({
    kind: 'total',
    label: 'Tendered',
    value: amount(
      figures.cashMinor +
        figures.creditMinor +
        figures.momoMinor +
        figures.cardMinor +
        figures.bankTransferMinor,
    ),
  })

  lines.push({ kind: 'rule' })
  lines.push({ kind: 'title', label: 'DRAWER' })
  lines.push({ kind: 'row', label: 'Opening float', value: amount(figures.openingFloatMinor) })
  // The same number as TENDERS' `Cash`, deliberately: it is the cash the shift
  // took, and the drawer adds it up rather than restating it differently.
  lines.push({ kind: 'row', label: 'Cash taken', value: amount(figures.cashMinor) })
  // Deductions are printed as deductions, in the order the money left: change,
  // then the cash refund that Phase 13's expected-cash sum already nets off.
  lines.push({ kind: 'row', label: 'Change given', value: amount(-figures.changeMinor) })
  lines.push({
    kind: 'row',
    label: 'Cash refunds',
    value: figures.cashRefundMinor === null ? 'not itemised' : amount(-figures.cashRefundMinor),
  })
  lines.push({ kind: 'row', label: 'Cash in', value: amount(figures.cashInMinor) })
  lines.push({ kind: 'row', label: 'Cash out', value: amount(-figures.cashOutMinor) })
  // The other direction of the same drawer: a debt paid in notes. Printed
  // between `Cash out` and `Expected` because it is a drawer movement, and its
  // own line because a reader who cannot see it reads the expected as inflated.
  lines.push({
    kind: 'row',
    label: 'Credit repaid (cash)',
    value:
      figures.cashRepaymentMinor === null ? 'not itemised' : amount(figures.cashRepaymentMinor),
  })
  lines.push({ kind: 'row', label: 'Expected', value: amount(figures.expectedCashMinor) })
  lines.push({
    kind: 'row',
    label: 'Counted',
    value: figures.countedCashMinor === null ? 'not counted' : amount(figures.countedCashMinor),
  })
  lines.push({
    kind: 'total',
    label: 'Variance',
    value: figures.varianceMinor === null ? 'not counted' : context.varianceLabel,
  })

  lines.push({ kind: 'rule' })
  lines.push({ kind: 'title', label: 'VOIDS' })
  lines.push({ kind: 'row', label: 'Voided carts', value: String(figures.voidCount) })

  lines.push({ kind: 'rule' })
  lines.push({
    kind: 'row',
    label: kind === 'Z' ? 'Stored at close' : 'Not stored, not a close',
    value: kind === 'Z' ? 'immutable' : 'live',
  })
  lines.push({
    kind: 'row',
    label: 'Generated',
    value: formatAccraDateTime(context.generatedAt),
  })
  lines.push({ kind: 'rule' })
  // The signature belongs to the person who counted the drawer. On an X nobody
  // has closed anything, so it stays the cashier's line.
  lines.push({
    kind: 'row',
    label: context.closedByName ? 'Closed by' : 'Cashier',
    value: context.closedByName ?? context.cashierName,
  })
  lines.push({ kind: 'row', label: 'Signature', value: '______________________' })

  return {
    title: kind === 'Z' ? 'Z-REPORT' : 'X-REPORT',
    reference: context.shiftNumber,
    lines,
  }
}

/**
 * The same document as plain text at 42 columns.
 *
 * The screen shows the paper, not a paraphrase of it, and the fake adapter's
 * file is compared with this string in the print smoke script.
 */
export function reportDocumentText(document: ReportDocument): string {
  return document.lines
    .map((line) => {
      switch (line.kind) {
        case 'title':
          return center(line.label ?? '')
        case 'rule':
          return '-'.repeat(REPORT_COLUMNS)
        default:
          return padLabel(line.label ?? '', line.value ?? '')
      }
    })
    .join('\n')
}
