import type { PowerSyncDatabase, Transaction } from '@powersync/web'
import { getBinding, type LocalStaffBinding } from '../auth/bindings'
import { requireStaffSession } from '../auth/staff-session'
import { type CartPricingContext, type CartTotals, computeCartTotals } from '../cart/totals'
import type { CartState } from '../cart/types'
import { isUuid } from '../id'
import type { PosIdentity } from '../pos-config'
import { findOpenShift, insertOutbox, type LocalShift } from '../shift/shift-repository'
import { allocateReceiptNumber } from './document-sequence'
import {
  buildSaleDraft,
  type SaleCashierDraft,
  type SaleDraft,
  SaleDraftError,
  type TenderMethod,
} from './sale-draft'
import {
  clearCartDraftRows,
  findSale,
  insertCreditDelta,
  insertLoyaltyDeltas,
  insertSale,
  insertSaleLines,
  insertSaleTenders,
  insertStockDeltas,
  type SaleLineRow,
  type SaleRow,
  type SaleTenderRow,
} from './sale-repository'

/**
 * Atomic offline sale completion (Plan 07 Task 1).
 *
 * One local transaction writes the sale, its lines, tenders, pending deltas,
 * the outbox row, and clears the cart draft. Nothing is awaited from the
 * network and nothing is printed here: a printer problem must not be able to
 * roll back a sale (D28).
 *
 * The pricing is **recomputed** from the cart with the shared `priceCart`, then
 * handed to `buildSaleDraft`, so the stored money and the uploaded payload come
 * from the same call. The cashier's charged prices are facts; the server
 * compares them and raises a conflict rather than repricing (D15).
 */

export type SaleCompletionCode =
  | 'NO_LINES'
  | 'NO_SHIFT'
  | 'SHIFT_MISMATCH'
  | 'NO_CUSTOMER_FOR_CREDIT'
  | 'INVALID_TENDER'
  | 'CASH_BELOW_TOTAL'
  | 'DUPLICATE_SALE'
  | 'NOT_SIGNED_IN'
  | 'STALE_BINDING'
  | 'INVALID_CART'

export class SaleCompletionError extends Error {
  readonly code: SaleCompletionCode

  constructor(code: SaleCompletionCode, message: string) {
    super(message)
    this.name = 'SaleCompletionError'
    this.code = code
  }
}

export interface TenderIntent {
  method: TenderMethod
  /** Cash handed over for CASH; ignored (and must be 0) for a zero total. */
  amountMinor: number
}

export interface CompleteSaleInput {
  cart: CartState
  tender: TenderIntent
  cashier: SaleCashierDraft
  identity: PosIdentity
  pricing: CartPricingContext
  appVersion?: string | undefined
  /** Injectable clock so the sequence/day tests are deterministic. */
  now?: Date | undefined
}

export interface PreparedSale {
  receiptNumber: string
  occurredAt: string
  draft: SaleDraft
  sale: SaleRow
  lines: SaleLineRow[]
  tenders: SaleTenderRow[]
  stockDeltas: Array<{ productId: string; quantityDelta: number }>
  creditDelta: { customerId: string; amountMinor: number } | null
  loyaltyDeltas: Array<{ customerId: string; pointsDelta: number }>
}

export interface CompleteSaleResult {
  saleId: string
  receiptNumber: string
  totalMinor: number
  changeMinor: number
  tenderMethod: TenderMethod | 'NONE'
}

function completionError(code: SaleCompletionCode, message: string): never {
  throw new SaleCompletionError(code, message)
}

function assertMoney(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    completionError('INVALID_TENDER', `${label} must be non-negative whole pesewas`)
  }
}

/**
 * Pure preparation: validates the cart/tender, prices it, and builds every row
 * that will be written. No database access, so the whole contract is testable.
 */
export function prepareSale(
  input: CompleteSaleInput,
  receiptNumber: string,
  occurredAt: string,
): PreparedSale {
  const { cart, tender, pricing } = input

  if (!isUuid(cart.saleId)) completionError('INVALID_CART', 'The cart has no sale id')
  if (cart.lines.length === 0) completionError('NO_LINES', 'A sale needs at least one line')
  if (!cart.shiftId) completionError('NO_SHIFT', 'Open a shift before completing a sale')

  const totals: CartTotals = computeCartTotals(cart, pricing)
  const totalMinor = totals.priced.totalMinor
  assertMoney(totalMinor, 'The sale total')
  assertMoney(tender.amountMinor, 'The tendered amount')

  const customerId: string | null = cart.customer?.customerId ?? cart.customer?.draftId ?? null

  const zeroTotal = totalMinor === 0
  const isCredit = tender.method === 'CREDIT' && !zeroTotal

  if (zeroTotal && tender.amountMinor !== 0) {
    completionError('INVALID_TENDER', 'A zero-total sale takes no payment')
  }
  if (isCredit && !customerId) {
    completionError('NO_CUSTOMER_FOR_CREDIT', 'A credit sale needs a customer')
  }
  if (isCredit && tender.amountMinor !== totalMinor) {
    completionError('INVALID_TENDER', 'A credit sale charges exactly the total')
  }
  if (!zeroTotal && !isCredit && tender.amountMinor < totalMinor) {
    completionError('CASH_BELOW_TOTAL', 'The cash tendered is below the total')
  }

  let draft: SaleDraft
  try {
    draft = buildSaleDraft({
      cart,
      totals,
      cashier: input.cashier,
      shiftId: cart.shiftId,
      receiptNumber,
      tender: {
        method: tender.method,
        amountMinor: zeroTotal ? 0 : tender.amountMinor,
        override: tender.method === 'CREDIT' ? cart.creditOverride : null,
      },
      occurredAt,
      appVersion: input.appVersion,
    })
  } catch (error) {
    if (error instanceof SaleDraftError) {
      completionError(
        error.code === 'NO_LINES'
          ? 'NO_LINES'
          : error.code === 'NO_SHIFT'
            ? 'NO_SHIFT'
            : error.code === 'NO_CUSTOMER_FOR_CREDIT'
              ? 'NO_CUSTOMER_FOR_CREDIT'
              : 'CASH_BELOW_TOTAL',
        error.message,
      )
    }
    throw error
  }

  const creditAmountMinor = isCredit ? tender.amountMinor : 0
  const changeMinor = draft.payload.totals.changeMinor

  const sale: SaleRow = {
    id: cart.saleId,
    receiptNumber,
    branchId: input.identity.branchId,
    terminalId: input.identity.terminalId,
    deviceId: input.identity.deviceId,
    shiftId: cart.shiftId,
    clientTransactionId: cart.saleId,
    cashierUserId: input.cashier.userId,
    cashierStaffId: input.cashier.staffId,
    customerId,
    occurredAt,
    subtotalMinor: totals.priced.subtotalMinor,
    lineDiscountMinor: totals.priced.lineDiscountMinor,
    saleDiscountMinor: totals.priced.saleDiscountMinor,
    loyaltyRedeemPoints: totals.priced.loyaltyDiscountMinor > 0 ? cart.loyaltyRedeemPoints : 0,
    loyaltyDiscountMinor: totals.priced.loyaltyDiscountMinor,
    vatMinor: totals.priced.vatMinor,
    nhilMinor: totals.priced.nhilMinor,
    getfundMinor: totals.priced.getfundMinor,
    taxTotalMinor: totals.priced.taxTotalMinor,
    totalMinor,
    tenderTotalMinor: draft.payload.tenders.reduce((sum, row) => sum + row.amountMinor, 0),
    changeMinor,
    loyaltyEarnedPoints: customerId ? totals.earnPreviewPoints : 0,
    creditAmountMinor,
    taxMode: pricing.taxMode,
    appVersion: input.appVersion ?? null,
    printStatus: 'PENDING',
    printedAt: null,
    printError: null,
    reprintCount: 0,
    createdAt: occurredAt,
  }

  const lines: SaleLineRow[] = cart.lines.map((cartLine, index) => {
    const priced = totals.priced.lines[index]
    if (!priced || priced.productId !== cartLine.productId) {
      completionError('INVALID_CART', 'The cart could not be priced consistently')
    }
    return {
      saleId: cart.saleId,
      lineNumber: index + 1,
      productId: cartLine.productId,
      sku: cartLine.sku,
      name: cartLine.name,
      barcode: cartLine.barcode,
      quantity: cartLine.quantity,
      unitPriceMinor: cartLine.unitPriceMinor,
      expectedUnitPriceMinor: cartLine.unitPriceMinor,
      lineDiscountMinor: priced.lineDiscountMinor,
      saleDiscountMinor: priced.saleDiscountMinor,
      loyaltyDiscountMinor: priced.loyaltyDiscountMinor,
      netMinor: priced.netMinor,
      taxableMinor: priced.taxableMinor,
      baseMinor: priced.baseMinor,
      vatMinor: priced.vatMinor,
      nhilMinor: priced.nhilMinor,
      getfundMinor: priced.getfundMinor,
      taxTotalMinor: priced.taxTotalMinor,
      totalMinor: priced.totalMinor,
      taxCategory: cartLine.taxCategory,
    }
  })

  const tenders: SaleTenderRow[] = draft.payload.tenders.map((row) => ({
    saleId: cart.saleId,
    method: row.method,
    amountMinor: row.amountMinor,
    reference: null,
    createdAt: occurredAt,
  }))

  // Stock deltas aggregate by product: two cart lines of the same product are
  // two receipt lines but one movement quantity.
  const byProduct = new Map<string, number>()
  for (const line of lines) {
    byProduct.set(line.productId, (byProduct.get(line.productId) ?? 0) + line.quantity)
  }
  const stockDeltas = [...byProduct.entries()].map(([productId, quantity]) => ({
    productId,
    quantityDelta: -quantity,
  }))

  const loyaltyDeltas: Array<{ customerId: string; pointsDelta: number }> = []
  if (customerId) {
    if (cart.loyaltyRedeemPoints > 0) {
      loyaltyDeltas.push({ customerId, pointsDelta: -cart.loyaltyRedeemPoints })
    }
    if (totals.earnPreviewPoints > 0) {
      loyaltyDeltas.push({ customerId, pointsDelta: totals.earnPreviewPoints })
    }
  }

  return {
    receiptNumber,
    occurredAt,
    draft,
    sale,
    lines,
    tenders,
    stockDeltas,
    creditDelta:
      creditAmountMinor > 0 && customerId ? { customerId, amountMinor: creditAmountMinor } : null,
    loyaltyDeltas,
  }
}

export interface SaleTransaction {
  insert(prepared: PreparedSale, saleId: string): Promise<void>
}

/** The write half, exported so a fake transaction can prove atomicity. */
export async function writePreparedSale(tx: Transaction, prepared: PreparedSale): Promise<void> {
  await insertSale(tx, prepared.sale)
  await insertSaleLines(tx, prepared.lines)
  await insertSaleTenders(tx, prepared.tenders)
  await insertStockDeltas(
    tx,
    prepared.stockDeltas.map((row) => ({
      saleId: prepared.sale.id,
      productId: row.productId,
      quantityDelta: row.quantityDelta,
      ackedAt: null,
    })),
  )
  if (prepared.creditDelta) {
    await insertCreditDelta(tx, {
      saleId: prepared.sale.id,
      customerId: prepared.creditDelta.customerId,
      amountMinor: prepared.creditDelta.amountMinor,
      ackedAt: null,
    })
  }
  await insertLoyaltyDeltas(
    tx,
    prepared.loyaltyDeltas.map((row) => ({
      saleId: prepared.sale.id,
      customerId: row.customerId,
      pointsDelta: row.pointsDelta,
      ackedAt: null,
    })),
  )
  await insertOutbox(tx, {
    id: prepared.sale.id,
    clientTransactionId: prepared.sale.clientTransactionId,
    type: 'SALE',
    occurredAt: prepared.occurredAt,
    payload: prepared.draft.payload,
  })
  await clearCartDraftRows(tx, prepared.sale.id)
}

async function requireOpenShift(
  db: PowerSyncDatabase,
  terminalId: string,
  shiftId: string,
): Promise<LocalShift> {
  const shift = await findOpenShift(db, terminalId)
  if (!shift) completionError('NO_SHIFT', 'Open a shift before completing a sale')
  if (shift.id !== shiftId) {
    completionError('SHIFT_MISMATCH', 'The cart belongs to a different shift')
  }
  return shift
}

async function requireBinding(
  db: PowerSyncDatabase,
  input: CompleteSaleInput,
): Promise<LocalStaffBinding> {
  const binding = await getBinding(db, input.cashier.bindingId)
  if (
    !binding ||
    !binding.isActive ||
    binding.userId !== input.cashier.userId ||
    binding.staffId !== input.cashier.staffId ||
    binding.pinVersion !== input.cashier.pinVersion ||
    Date.parse(binding.expiresAt) <= Date.now()
  ) {
    completionError('STALE_BINDING', 'Sign in again — this PIN has changed')
  }
  const session = requireStaffSession()
  if (session.userId !== input.cashier.userId || session.bindingId !== input.cashier.bindingId) {
    completionError('NOT_SIGNED_IN', 'Sign in with a PIN before completing a sale')
  }
  return binding
}

/**
 * Completes the sale: one local transaction, no network, no printing.
 *
 * Throws `SaleCompletionError` **before** the transaction for a bad cart and
 * inside it for an integrity failure; in both cases the cart draft is intact
 * and the cashier can retry or keep editing.
 */
export async function completeSale(
  db: PowerSyncDatabase,
  input: CompleteSaleInput,
): Promise<CompleteSaleResult> {
  if (!isUuid(input.cart.saleId)) {
    completionError('INVALID_CART', 'The cart has no sale id')
  }

  const shift = await requireOpenShift(db, input.identity.terminalId, input.cart.shiftId ?? '')
  await requireBinding(db, input)

  const now = input.now ?? new Date()
  const occurredAt = now.toISOString()

  const existing = await findSale(db, input.cart.saleId)
  if (existing) completionError('DUPLICATE_SALE', 'This sale was already completed')

  const prepared = await db.writeTransaction(async (tx) => {
    const receiptNumber = await allocateReceiptNumber(
      tx,
      input.identity.terminalId,
      input.identity.terminalCode,
      now,
    )
    const ready = prepareSale(input, receiptNumber, occurredAt)
    if (ready.sale.shiftId !== shift.id) {
      completionError('SHIFT_MISMATCH', 'The cart belongs to a different shift')
    }
    await writePreparedSale(tx, ready)
    return ready
  })

  return {
    saleId: prepared.sale.id,
    receiptNumber: prepared.receiptNumber,
    totalMinor: prepared.sale.totalMinor,
    changeMinor: prepared.sale.changeMinor,
    tenderMethod: prepared.tenders.length === 0 ? 'NONE' : (prepared.tenders[0]?.method ?? 'CASH'),
  }
}
