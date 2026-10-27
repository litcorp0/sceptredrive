import type { PowerSyncDatabase } from '@powersync/web'
import { refundableTenderRemainders } from '@sceptre/shared'
import { phoneMatchDigits } from '../customers/search'
import { parseTenderMethod } from '../sale/sale-draft'
import {
  RefundError,
  type RefundReader,
  type RefundSource,
  type RefundSourceLine,
  type RefundSourceTender,
  type SaleSearchRow,
} from './refund-types'

/**
 * Refund lookup and source loading (Plan 10 Task 1).
 *
 * The till refunds from **its own** `sale` rows (P13-D25): another terminal's
 * sale is not a local fact, and the stock and credit deltas it would unwind are
 * not knowable here. Every query is therefore filtered by this terminal, and a
 * sale that turns up under another terminal is refused with a sentence a
 * cashier can act on rather than hidden.
 */

export const REFUND_SEARCH_LIMIT = 20

interface LocalTerminalRow {
  terminal_id: string
  terminal_code: string
  branch_id: string
}

/** This terminal's identity, from the local config snapshot. */
export async function readLocalTerminal(reader: RefundReader): Promise<LocalTerminalRow | null> {
  return reader.getOptional<LocalTerminalRow>(
    'SELECT terminal_id, terminal_code, branch_id FROM pos_config WHERE id = ?',
    ['current'],
  )
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`)
}

/**
 * A phone pattern that matches nothing, so an empty search box does not turn
 * into "every sale on this terminal".
 */
const NO_PHONE_MATCH = '%__no_phone_match__%'

interface SaleSearchDbRow {
  sale_id: string
  receipt_number: string
  occurred_at: string
  total_minor: number
  tender_total_minor: number
  change_minor: number
  refunded_minor: number
  customer_name: string | null
}

const SALE_SEARCH_SQL = `SELECT s.id AS sale_id,
       s.receipt_number,
       s.occurred_at,
       s.total_minor,
       s.tender_total_minor,
       s.change_minor,
       COALESCE((SELECT SUM(r.refunded_minor) FROM refund r WHERE r.sale_id = s.id), 0)
         AS refunded_minor,
       COALESCE(
         (SELECT c.name FROM customer c WHERE c.id = s.customer_id),
         (SELECT d.name FROM customer_draft d WHERE d.id = s.customer_id)
       ) AS customer_name
  FROM sale s
 WHERE s.terminal_id = ?
   AND (
     s.receipt_number LIKE ? ESCAPE '\\'
     OR (
       s.customer_id IS NOT NULL
       AND (
         s.customer_id IN (SELECT id FROM customer WHERE phone LIKE ? ESCAPE '\\')
         OR s.customer_id IN (SELECT id FROM customer_draft WHERE phone LIKE ? ESCAPE '\\')
       )
     )
   )
 ORDER BY s.occurred_at DESC
 LIMIT ?`

/**
 * Finds this terminal's sales by receipt number (exact or prefix) or by the
 * customer's phone. A fully refunded sale is still returned: the cashier needs
 * to know it was already refunded, not to wonder where it went.
 */
export async function searchRefundableSales(
  db: PowerSyncDatabase,
  input: { query: string; limit?: number },
): Promise<SaleSearchRow[]> {
  const term = input.query.trim()
  if (!term) return []

  const terminal = await readLocalTerminal(db)
  if (!terminal) return []

  const limit = Math.min(Math.max(1, input.limit ?? REFUND_SEARCH_LIMIT), 50)
  const receiptPattern = `${escapeLike(term)}%`
  const digits = phoneMatchDigits(term)
  const phonePattern = digits.length >= 3 ? `%${digits}%` : NO_PHONE_MATCH

  const rows = await db.getAll<SaleSearchDbRow>(SALE_SEARCH_SQL, [
    terminal.terminal_id,
    receiptPattern,
    phonePattern,
    phonePattern,
    limit,
  ])

  return rows.map((row) => {
    const keptMinor = Math.max(0, row.tender_total_minor - row.change_minor)
    return {
      saleId: row.sale_id,
      receiptNumber: row.receipt_number,
      occurredAt: row.occurred_at,
      totalMinor: row.total_minor,
      refundedMinor: row.refunded_minor,
      refundableMinor: Math.max(0, keptMinor - row.refunded_minor),
      customerName: row.customer_name,
    }
  })
}

interface SaleDbRow {
  id: string
  receipt_number: string
  terminal_id: string
  shift_id: string
  occurred_at: string
  total_minor: number
  tender_total_minor: number
  change_minor: number
  tax_mode: string
  customer_id: string | null
  customer_name: string | null
}

interface SaleLineDbRow {
  id: string
  line_number: number
  product_id: string
  name: string
  quantity: number
  unit_price_minor: number
  tax_category: string
  base_minor: number
  vat_minor: number
  nhil_minor: number
  getfund_minor: number
  tax_total_minor: number
  total_minor: number
}

interface PriorLineDbRow {
  sale_line_id: string
  quantity: number
}

interface TenderDbRow {
  id: string
  sequence: number | null
  method: string
  amount_minor: number
  payment_id: string | null
}

interface TenderTotalDbRow {
  sale_tender_id: string
  total: number
}

interface TotalDbRow {
  total: number
}

/**
 * Reads one sale and everything a refund against it needs: its lines, its
 * tenders with the change already netted out, and what earlier refunds took.
 *
 * Takes a reader so the write path can run it **inside** the refund's
 * transaction and read exactly what it is about to cap against.
 */
export async function loadRefundSource(
  reader: RefundReader,
  saleId: string,
  terminalId: string,
): Promise<RefundSource> {
  const sale = await reader.getOptional<SaleDbRow>(
    `SELECT s.id, s.receipt_number, s.terminal_id, s.shift_id, s.occurred_at,
            s.total_minor, s.tender_total_minor, s.change_minor, s.tax_mode, s.customer_id,
            COALESCE(
              (SELECT c.name FROM customer c WHERE c.id = s.customer_id),
              (SELECT d.name FROM customer_draft d WHERE d.id = s.customer_id)
            ) AS customer_name
       FROM sale s
      WHERE s.id = ?`,
    [saleId],
  )
  if (!sale) {
    throw new RefundError('SALE_NOT_FOUND', 'That receipt is not on this terminal')
  }
  if (sale.terminal_id !== terminalId) {
    throw new RefundError(
      'FOREIGN_SALE',
      'That receipt was taken at another terminal; a manager must refund it from the office console',
    )
  }

  const [lineRows, priorRows, tenderRows, tenderTotals, refunded] = await Promise.all([
    reader.getAll<SaleLineDbRow>(
      `SELECT id, line_number, product_id, name, quantity, unit_price_minor, tax_category,
              base_minor, vat_minor, nhil_minor, getfund_minor, tax_total_minor, total_minor
         FROM sale_line
        WHERE sale_id = ?
        ORDER BY line_number`,
      [saleId],
    ),
    reader.getAll<PriorLineDbRow>(
      `SELECT rl.sale_line_id, rl.quantity
         FROM refund_line rl
         JOIN refund r ON r.id = rl.refund_id
        WHERE r.sale_id = ?
        ORDER BY r.created_at, r.id`,
      [saleId],
    ),
    reader.getAll<TenderDbRow>(
      `SELECT id, sequence, method, amount_minor, payment_id
         FROM sale_tender
        WHERE sale_id = ?
        ORDER BY COALESCE(sequence, 1), created_at, id`,
      [saleId],
    ),
    reader.getAll<TenderTotalDbRow>(
      `SELECT rt.sale_tender_id, COALESCE(SUM(rt.amount_minor), 0) AS total
         FROM refund_tender rt
         JOIN refund r ON r.id = rt.refund_id
        WHERE r.sale_id = ?
        GROUP BY rt.sale_tender_id`,
      [saleId],
    ),
    reader.getOptional<TotalDbRow>(
      'SELECT COALESCE(SUM(refunded_minor), 0) AS total FROM refund WHERE sale_id = ?',
      [saleId],
    ),
  ])

  const priorByLine = new Map<string, number[]>()
  for (const row of priorRows) {
    const list = priorByLine.get(row.sale_line_id) ?? []
    list.push(row.quantity)
    priorByLine.set(row.sale_line_id, list)
  }

  const lines: RefundSourceLine[] = lineRows.map((row) => ({
    saleLineId: row.id,
    lineNumber: row.line_number,
    productId: row.product_id,
    name: row.name,
    quantity: row.quantity,
    unitPriceMinor: row.unit_price_minor,
    taxCategory: row.tax_category,
    baseMinor: row.base_minor,
    vatMinor: row.vat_minor,
    nhilMinor: row.nhil_minor,
    getfundMinor: row.getfund_minor,
    taxTotalMinor: row.tax_total_minor,
    totalMinor: row.total_minor,
    priorRefundQuantities: priorByLine.get(row.id) ?? [],
  }))

  const refundedByTender = new Map(tenderTotals.map((row) => [row.sale_tender_id, row.total]))
  const tenders: RefundSourceTender[] = tenderRows.map((row) => ({
    saleTenderId: row.id,
    sequence: row.sequence ?? 1,
    method: parseTenderMethod(row.method),
    amountMinor: row.amount_minor,
    paymentId: row.payment_id,
    alreadyRefundedMinor: refundedByTender.get(row.id) ?? 0,
    refundableMinor: 0,
  }))

  const remainders = refundableTenderRemainders(
    tenders.map((tender) => ({
      saleTenderId: tender.saleTenderId,
      method: tender.method,
      amountMinor: tender.amountMinor,
      refundedMinor: tender.alreadyRefundedMinor,
    })),
    sale.change_minor,
  )
  const remainingById = new Map(remainders.map((row) => [row.saleTenderId, row.refundableMinor]))
  for (const tender of tenders) {
    tender.refundableMinor = remainingById.get(tender.saleTenderId) ?? 0
  }

  return {
    saleId: sale.id,
    receiptNumber: sale.receipt_number,
    terminalId: sale.terminal_id,
    shiftId: sale.shift_id,
    occurredAt: sale.occurred_at,
    taxMode: sale.tax_mode,
    customerName: sale.customer_name,
    totalMinor: sale.total_minor,
    tenderTotalMinor: sale.tender_total_minor,
    changeMinor: sale.change_minor,
    previouslyRefundedMinor: refunded?.total ?? 0,
    lines,
    tenders,
  }
}

/** `loadRefundSource` for the screen: resolves this terminal first. */
export async function loadRefundDraft(
  db: PowerSyncDatabase,
  saleId: string,
): Promise<RefundSource> {
  const terminal = await readLocalTerminal(db)
  if (!terminal) {
    throw new RefundError('NOT_SIGNED_IN', 'This terminal is not configured yet')
  }
  return loadRefundSource(db, saleId, terminal.terminal_id)
}
