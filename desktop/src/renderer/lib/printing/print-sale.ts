import type { PowerSyncDatabase } from '@powersync/web'
import type { PrintOutcome } from '../../../shared/printing'
import {
  buildReceiptModel,
  type ReceiptContext,
  type ReceiptCustomer,
  toEscPosLines,
} from '../receipt/render'
import {
  findSale,
  listSaleLines,
  listSaleTenders,
  type PrintStatus,
  readCashierName,
  readReceiptContext,
  type SaleLineRow,
  type SaleRow,
  type SaleTenderRow,
  setPrintState,
} from '../sale/sale-repository'
import type { PrinterTransport } from './printer-service'
import { type PrinterSettings, toPrinterTarget } from './settings'

/**
 * Print orchestration (Plan 07 Task 4).
 *
 * The sale is already committed when this runs. Every failure path here leaves
 * the sale intact and records a retryable print state: the till never blocks on
 * a printer (D28).
 *
 * The store and transport are injected so the state machine (PRINTING →
 * PRINTED/FAILED, drawer kick, reprint marker) is unit-testable without
 * Electron or a database.
 */

export interface SaleStore {
  getSale(saleId: string): Promise<SaleRow | null>
  getLines(saleId: string): Promise<SaleLineRow[]>
  getTenders(saleId: string): Promise<SaleTenderRow[]>
  getContext(): Promise<ReceiptContext>
  getCashierName(staffId: string): Promise<string | null>
  getCustomer(customerId: string): Promise<ReceiptCustomer | null>
  setPrintState(
    saleId: string,
    patch: {
      status: PrintStatus
      printedAt?: string | null
      error?: string | null
      incrementReprint?: boolean
    },
  ): Promise<void>
}

export interface PrintSaleDeps {
  store: SaleStore
  transport: PrinterTransport
  settings: PrinterSettings
  now?: () => Date
}

export interface PrintSaleOptions {
  /** Adds `*** REPRINT ***`, prints the marker, and increments the counter. */
  reprint?: boolean
}

export interface PrintSaleResult {
  printStatus: PrintStatus
  outcome: PrintOutcome
  reprint: boolean
}

const MAX_PRINT_ERROR = 200

function errorDetail(outcome: PrintOutcome): string | null {
  if (outcome.ok) return null
  return `${outcome.code}: ${outcome.message}`.slice(0, MAX_PRINT_ERROR)
}

export async function printSale(
  deps: PrintSaleDeps,
  saleId: string,
  options: PrintSaleOptions = {},
): Promise<PrintSaleResult> {
  const sale = await deps.store.getSale(saleId)
  if (!sale) throw new Error('The sale to print no longer exists')

  const [lines, tenders, context, cashierName, customer] = await Promise.all([
    deps.store.getLines(saleId),
    deps.store.getTenders(saleId),
    deps.store.getContext(),
    deps.store.getCashierName(sale.cashierStaffId),
    sale.customerId ? deps.store.getCustomer(sale.customerId) : Promise.resolve(null),
  ])

  const reprint = options.reprint === true
  const model = buildReceiptModel({
    sale,
    lines,
    tenders,
    context,
    cashierName,
    customer,
    reprint,
  })

  const job = {
    receiptNumber: sale.receiptNumber,
    lines: toEscPosLines(model, {
      columns: 42,
      currencySymbol: deps.settings.currencySymbol,
    }),
    encoding: deps.settings.encoding,
    copies: deps.settings.copies,
    // The drawer opens only with a real cash tender, after the receipt prints.
    openDrawer: tenders.some((tender) => tender.method === 'CASH'),
    drawerPin: deps.settings.drawerPin,
  }

  await deps.store.setPrintState(saleId, { status: 'PRINTING' })

  const outcome = await deps.transport.print(toPrinterTarget(deps.settings), job)
  const printedAt = (deps.now?.() ?? new Date()).toISOString()

  if (!outcome.ok) {
    await deps.store.setPrintState(saleId, {
      status: 'FAILED',
      error: errorDetail(outcome),
      printedAt: null,
    })
    return { printStatus: 'FAILED', outcome, reprint }
  }

  await deps.store.setPrintState(saleId, {
    status: 'PRINTED',
    printedAt,
    error: null,
    incrementReprint: reprint,
  })

  // The receipt itself carried the drawer kick (`openDrawer` above), so a cash
  // sale has already opened the drawer by the time this resolves.
  return { printStatus: 'PRINTED', outcome, reprint }
}

export interface OpenDrawerDeps {
  transport: PrinterTransport
  settings: PrinterSettings
}

/** The manual escape hatch when a receipt failed but the customer paid cash. */
export async function openDrawerNow(deps: OpenDrawerDeps): Promise<PrintOutcome> {
  return deps.transport.openDrawer(toPrinterTarget(deps.settings), deps.settings.drawerPin)
}

/** Production store over the encrypted local database. */
export function createSaleStore(db: PowerSyncDatabase): SaleStore {
  return {
    getSale: (saleId) => findSale(db, saleId),
    getLines: (saleId) => listSaleLines(db, saleId),
    getTenders: (saleId) => listSaleTenders(db, saleId),
    async getContext() {
      const context = await readReceiptContext(db)
      if (!context) throw new Error('This terminal is not configured yet')
      return context
    },
    getCashierName: (staffId) => readCashierName(db, staffId),
    async getCustomer(customerId) {
      const synced = await db.getOptional<{ name: string; phone: string }>(
        'SELECT name, phone FROM customer WHERE id = ?',
        [customerId],
      )
      if (synced) return { name: synced.name, phone: synced.phone }
      const draft = await db.getOptional<{ name: string; phone: string }>(
        'SELECT name, phone FROM customer_draft WHERE id = ?',
        [customerId],
      )
      return draft ? { name: draft.name, phone: draft.phone } : null
    },
    setPrintState: (saleId, patch) => setPrintState(db, saleId, patch),
  }
}
