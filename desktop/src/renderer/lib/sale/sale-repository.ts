import type { PowerSyncDatabase, Transaction } from '@powersync/web'

/**
 * Local-only sale data access (D8/D11).
 *
 * Every write takes the transaction the completion service opened, so the sale,
 * its lines, tenders, pending deltas, outbox row, and the cart cleanup commit
 * together. Reads are plain local queries and work offline.
 */

export const PRINT_STATUSES = ['PENDING', 'PRINTING', 'PRINTED', 'FAILED'] as const
export type PrintStatus = (typeof PRINT_STATUSES)[number]

export interface SaleRow {
  id: string
  receiptNumber: string
  branchId: string
  terminalId: string
  deviceId: string
  shiftId: string
  clientTransactionId: string
  cashierUserId: string
  cashierStaffId: string
  customerId: string | null
  occurredAt: string
  subtotalMinor: number
  lineDiscountMinor: number
  saleDiscountMinor: number
  loyaltyRedeemPoints: number
  loyaltyDiscountMinor: number
  vatMinor: number
  nhilMinor: number
  getfundMinor: number
  taxTotalMinor: number
  totalMinor: number
  tenderTotalMinor: number
  changeMinor: number
  loyaltyEarnedPoints: number
  creditAmountMinor: number
  taxMode: string
  appVersion: string | null
  printStatus: PrintStatus
  printedAt: string | null
  printError: string | null
  reprintCount: number
  createdAt: string
}

export interface SaleLineRow {
  saleId: string
  lineNumber: number
  productId: string
  sku: string
  name: string
  barcode: string | null
  quantity: number
  unitPriceMinor: number
  expectedUnitPriceMinor: number
  lineDiscountMinor: number
  saleDiscountMinor: number
  loyaltyDiscountMinor: number
  netMinor: number
  taxableMinor: number
  baseMinor: number
  vatMinor: number
  nhilMinor: number
  getfundMinor: number
  taxTotalMinor: number
  totalMinor: number
  taxCategory: string
}

export interface SaleTenderRow {
  saleId: string
  method: 'CASH' | 'CREDIT'
  amountMinor: number
  reference: string | null
  createdAt: string
}

export interface SaleStockDeltaRow {
  saleId: string
  productId: string
  quantityDelta: number
  ackedAt: string | null
}

export interface SaleCreditDeltaRow {
  saleId: string
  customerId: string
  amountMinor: number
  ackedAt: string | null
}

export interface SaleLoyaltyDeltaRow {
  saleId: string
  customerId: string
  pointsDelta: number
  ackedAt: string | null
}

const SALE_COLUMNS = `id, receipt_number, branch_id, terminal_id, device_id, shift_id,
  client_transaction_id, cashier_user_id, cashier_staff_id, customer_id, occurred_at,
  subtotal_minor, line_discount_minor, sale_discount_minor, loyalty_redeem_points,
  loyalty_discount_minor, vat_minor, nhil_minor, getfund_minor, tax_total_minor,
  total_minor, tender_total_minor, change_minor, loyalty_earned_points,
  credit_amount_minor, tax_mode, app_version, print_status, printed_at, print_error,
  reprint_count, created_at`

const SALE_LINE_COLUMNS = `sale_id, line_number, product_id, sku, name, barcode, quantity,
  unit_price_minor, expected_unit_price_minor, line_discount_minor, sale_discount_minor,
  loyalty_discount_minor, net_minor, taxable_minor, base_minor, vat_minor, nhil_minor,
  getfund_minor, tax_total_minor, total_minor, tax_category`

const TENDER_COLUMNS = `sale_id, method, amount_minor, reference, created_at`

interface SaleDbRow {
  id: string
  receipt_number: string
  branch_id: string
  terminal_id: string
  device_id: string
  shift_id: string
  client_transaction_id: string
  cashier_user_id: string
  cashier_staff_id: string
  customer_id: string | null
  occurred_at: string
  subtotal_minor: number
  line_discount_minor: number
  sale_discount_minor: number
  loyalty_redeem_points: number
  loyalty_discount_minor: number
  vat_minor: number
  nhil_minor: number
  getfund_minor: number
  tax_total_minor: number
  total_minor: number
  tender_total_minor: number
  change_minor: number
  loyalty_earned_points: number
  credit_amount_minor: number
  tax_mode: string
  app_version: string | null
  print_status: string
  printed_at: string | null
  print_error: string | null
  reprint_count: number | null
  created_at: string
}

interface SaleLineDbRow {
  sale_id: string
  line_number: number
  product_id: string
  sku: string
  name: string
  barcode: string | null
  quantity: number
  unit_price_minor: number
  expected_unit_price_minor: number
  line_discount_minor: number
  sale_discount_minor: number
  loyalty_discount_minor: number
  net_minor: number
  taxable_minor: number
  base_minor: number
  vat_minor: number
  nhil_minor: number
  getfund_minor: number
  tax_total_minor: number
  total_minor: number
  tax_category: string
}

interface TenderDbRow {
  sale_id: string
  method: string
  amount_minor: number
  reference: string | null
  created_at: string
}

function toPrintStatus(status: string): PrintStatus {
  return (PRINT_STATUSES as readonly string[]).includes(status)
    ? (status as PrintStatus)
    : 'PENDING'
}

function toSale(row: SaleDbRow): SaleRow {
  return {
    id: row.id,
    receiptNumber: row.receipt_number,
    branchId: row.branch_id,
    terminalId: row.terminal_id,
    deviceId: row.device_id,
    shiftId: row.shift_id,
    clientTransactionId: row.client_transaction_id,
    cashierUserId: row.cashier_user_id,
    cashierStaffId: row.cashier_staff_id,
    customerId: row.customer_id,
    occurredAt: row.occurred_at,
    subtotalMinor: row.subtotal_minor,
    lineDiscountMinor: row.line_discount_minor,
    saleDiscountMinor: row.sale_discount_minor,
    loyaltyRedeemPoints: row.loyalty_redeem_points,
    loyaltyDiscountMinor: row.loyalty_discount_minor,
    vatMinor: row.vat_minor,
    nhilMinor: row.nhil_minor,
    getfundMinor: row.getfund_minor,
    taxTotalMinor: row.tax_total_minor,
    totalMinor: row.total_minor,
    tenderTotalMinor: row.tender_total_minor,
    changeMinor: row.change_minor,
    loyaltyEarnedPoints: row.loyalty_earned_points,
    creditAmountMinor: row.credit_amount_minor,
    taxMode: row.tax_mode,
    appVersion: row.app_version,
    printStatus: toPrintStatus(row.print_status),
    printedAt: row.printed_at,
    printError: row.print_error,
    reprintCount: row.reprint_count ?? 0,
    createdAt: row.created_at,
  }
}

function toLine(row: SaleLineDbRow): SaleLineRow {
  return {
    saleId: row.sale_id,
    lineNumber: row.line_number,
    productId: row.product_id,
    sku: row.sku,
    name: row.name,
    barcode: row.barcode,
    quantity: row.quantity,
    unitPriceMinor: row.unit_price_minor,
    expectedUnitPriceMinor: row.expected_unit_price_minor,
    lineDiscountMinor: row.line_discount_minor,
    saleDiscountMinor: row.sale_discount_minor,
    loyaltyDiscountMinor: row.loyalty_discount_minor,
    netMinor: row.net_minor,
    taxableMinor: row.taxable_minor,
    baseMinor: row.base_minor,
    vatMinor: row.vat_minor,
    nhilMinor: row.nhil_minor,
    getfundMinor: row.getfund_minor,
    taxTotalMinor: row.tax_total_minor,
    totalMinor: row.total_minor,
    taxCategory: row.tax_category,
  }
}

function toTender(row: TenderDbRow): SaleTenderRow {
  return {
    saleId: row.sale_id,
    method: row.method === 'CREDIT' ? 'CREDIT' : 'CASH',
    amountMinor: row.amount_minor,
    reference: row.reference,
    createdAt: row.created_at,
  }
}

// --- writes ----------------------------------------------------------------

export async function insertSale(tx: Transaction, sale: SaleRow): Promise<void> {
  await tx.execute(
    `INSERT INTO sale (${SALE_COLUMNS})
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      sale.id,
      sale.receiptNumber,
      sale.branchId,
      sale.terminalId,
      sale.deviceId,
      sale.shiftId,
      sale.clientTransactionId,
      sale.cashierUserId,
      sale.cashierStaffId,
      sale.customerId,
      sale.occurredAt,
      sale.subtotalMinor,
      sale.lineDiscountMinor,
      sale.saleDiscountMinor,
      sale.loyaltyRedeemPoints,
      sale.loyaltyDiscountMinor,
      sale.vatMinor,
      sale.nhilMinor,
      sale.getfundMinor,
      sale.taxTotalMinor,
      sale.totalMinor,
      sale.tenderTotalMinor,
      sale.changeMinor,
      sale.loyaltyEarnedPoints,
      sale.creditAmountMinor,
      sale.taxMode,
      sale.appVersion,
      sale.printStatus,
      sale.printedAt,
      sale.printError,
      sale.reprintCount,
      sale.createdAt,
    ],
  )
}

export async function insertSaleLines(tx: Transaction, lines: SaleLineRow[]): Promise<void> {
  for (const line of lines) {
    await tx.execute(
      `INSERT INTO sale_line (${SALE_LINE_COLUMNS})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        line.saleId,
        line.lineNumber,
        line.productId,
        line.sku,
        line.name,
        line.barcode,
        line.quantity,
        line.unitPriceMinor,
        line.expectedUnitPriceMinor,
        line.lineDiscountMinor,
        line.saleDiscountMinor,
        line.loyaltyDiscountMinor,
        line.netMinor,
        line.taxableMinor,
        line.baseMinor,
        line.vatMinor,
        line.nhilMinor,
        line.getfundMinor,
        line.taxTotalMinor,
        line.totalMinor,
        line.taxCategory,
      ],
    )
  }
}

export async function insertSaleTenders(tx: Transaction, tenders: SaleTenderRow[]): Promise<void> {
  for (const tender of tenders) {
    await tx.execute(`INSERT INTO sale_tender (${TENDER_COLUMNS}) VALUES (?, ?, ?, ?, ?)`, [
      tender.saleId,
      tender.method,
      tender.amountMinor,
      tender.reference,
      tender.createdAt,
    ])
  }
}

export async function insertStockDeltas(tx: Transaction, rows: SaleStockDeltaRow[]): Promise<void> {
  for (const row of rows) {
    await tx.execute(
      `INSERT INTO local_stock_delta (id, sale_id, product_id, quantity_delta, acked_at)
       VALUES (?, ?, ?, ?, ?)`,
      [crypto.randomUUID(), row.saleId, row.productId, row.quantityDelta, row.ackedAt],
    )
  }
}

export async function insertCreditDelta(tx: Transaction, row: SaleCreditDeltaRow): Promise<void> {
  await tx.execute(
    `INSERT INTO local_credit_delta (id, sale_id, customer_id, amount_minor, acked_at)
     VALUES (?, ?, ?, ?, ?)`,
    [crypto.randomUUID(), row.saleId, row.customerId, row.amountMinor, row.ackedAt],
  )
}

export async function insertLoyaltyDeltas(
  tx: Transaction,
  rows: SaleLoyaltyDeltaRow[],
): Promise<void> {
  for (const row of rows) {
    await tx.execute(
      `INSERT INTO local_loyalty_delta (id, sale_id, customer_id, points_delta, acked_at)
       VALUES (?, ?, ?, ?, ?)`,
      [crypto.randomUUID(), row.saleId, row.customerId, row.pointsDelta, row.ackedAt],
    )
  }
}

/** Removes the draft this sale was built from; other drafts are untouched. */
export async function clearCartDraftRows(tx: Transaction, draftId: string): Promise<void> {
  await tx.execute('DELETE FROM cart_draft_line WHERE draft_id = ?', [draftId])
  await tx.execute('DELETE FROM cart_draft WHERE id = ?', [draftId])
}

// --- reads -----------------------------------------------------------------

export interface SqlReader {
  getOptional<T>(sql: string, parameters?: unknown[]): Promise<T | null>
  getAll<T>(sql: string, parameters?: unknown[]): Promise<T[]>
}

export async function findSale(db: SqlReader, saleId: string): Promise<SaleRow | null> {
  const row = await db.getOptional<SaleDbRow>(`SELECT ${SALE_COLUMNS} FROM sale WHERE id = ?`, [
    saleId,
  ])
  return row ? toSale(row) : null
}

export async function listSaleLines(db: SqlReader, saleId: string): Promise<SaleLineRow[]> {
  const rows = await db.getAll<SaleLineDbRow>(
    `SELECT ${SALE_LINE_COLUMNS} FROM sale_line WHERE sale_id = ? ORDER BY line_number`,
    [saleId],
  )
  return rows.map(toLine)
}

export async function listSaleTenders(db: SqlReader, saleId: string): Promise<SaleTenderRow[]> {
  const rows = await db.getAll<TenderDbRow>(
    `SELECT ${TENDER_COLUMNS} FROM sale_tender WHERE sale_id = ? ORDER BY created_at`,
    [saleId],
  )
  return rows.map(toTender)
}

export async function listShiftSales(db: SqlReader, shiftId: string): Promise<SaleRow[]> {
  const rows = await db.getAll<SaleDbRow>(
    `SELECT ${SALE_COLUMNS} FROM sale WHERE shift_id = ? ORDER BY occurred_at DESC`,
    [shiftId],
  )
  return rows.map(toSale)
}

/** Today's sales on the terminal, plus any older receipt that still needs printing. */
export async function listSalesBetween(
  db: SqlReader,
  terminalId: string,
  fromIso: string,
  toIso: string,
): Promise<SaleRow[]> {
  const rows = await db.getAll<SaleDbRow>(
    `SELECT ${SALE_COLUMNS} FROM sale
      WHERE terminal_id = ?
        AND ((occurred_at >= ? AND occurred_at < ?)
             OR print_status IN ('PENDING', 'FAILED', 'PRINTING'))
      ORDER BY occurred_at DESC`,
    [terminalId, fromIso, toIso],
  )
  return rows.map(toSale)
}

export async function countUnprintedSales(db: SqlReader): Promise<number> {
  const row = await db.getOptional<{ count: number }>(
    `SELECT COUNT(*) AS count FROM sale WHERE print_status IN ('PENDING', 'FAILED', 'PRINTING')`,
  )
  return row?.count ?? 0
}

export async function setPrintState(
  db: { execute(sql: string, parameters?: unknown[]): Promise<unknown> },
  saleId: string,
  patch: {
    status: PrintStatus
    printedAt?: string | null
    error?: string | null
    incrementReprint?: boolean
  },
): Promise<void> {
  if (patch.incrementReprint) {
    await db.execute(
      `UPDATE sale SET print_status = ?, printed_at = ?, print_error = ?,
              reprint_count = COALESCE(reprint_count, 0) + 1
        WHERE id = ?`,
      [patch.status, patch.printedAt ?? null, patch.error ?? null, saleId],
    )
    return
  }
  await db.execute(
    'UPDATE sale SET print_status = ?, printed_at = ?, print_error = ? WHERE id = ?',
    [patch.status, patch.printedAt ?? null, patch.error ?? null, saleId],
  )
}

export interface PosReceiptContextRow {
  branchName: string
  branchCode: string
  terminalCode: string
  receiptHeader: string
  receiptFooter: string
}

export async function readReceiptContext(db: SqlReader): Promise<PosReceiptContextRow | null> {
  const row = await db.getOptional<{
    branch_name: string
    branch_code: string
    terminal_code: string
    receipt_header: string
    receipt_footer: string
  }>(
    `SELECT branch_name, branch_code, terminal_code, receipt_header, receipt_footer
       FROM pos_config WHERE id = 'current'`,
  )
  if (!row) return null
  return {
    branchName: row.branch_name,
    branchCode: row.branch_code,
    terminalCode: row.terminal_code,
    receiptHeader: row.receipt_header,
    receiptFooter: row.receipt_footer,
  }
}

export async function readCashierName(db: SqlReader, staffId: string): Promise<string | null> {
  const row = await db.getOptional<{ name: string }>(
    'SELECT name FROM staff_binding WHERE staff_id = ? ORDER BY bound_at DESC LIMIT 1',
    [staffId],
  )
  return row?.name ?? null
}

export type SaleDatabase = PowerSyncDatabase
