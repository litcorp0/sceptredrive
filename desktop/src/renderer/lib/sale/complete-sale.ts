import type { PowerSyncDatabase, Transaction } from '@powersync/web'
import { type TenderMethod, tenderBalance } from '@sceptre/shared'
import { getBinding, type LocalStaffBinding } from '../auth/bindings'
import { requireStaffSession } from '../auth/staff-session'
import { type CartPricingContext, type CartTotals, computeCartTotals } from '../cart/totals'
import type { CartState } from '../cart/types'
import { isUuid } from '../id'
import { notifyOutboxChanged } from '../outbox/outbox-events'
import type { PosIdentity } from '../pos-config'
import { findOpenShift, insertOutbox, type LocalShift } from '../shift/shift-repository'
import { allocateReceiptNumber } from './document-sequence'
import {
  buildSaleDraft,
  type SaleCashierDraft,
  type SaleDraft,
  SaleDraftError,
  type SaleTenderDraft,
  toTenderLines,
} from './sale-draft'
import {
  clearCartDraftRows,
  clearCartTenders,
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
 * Offline sale completion (Plan 07 Task 1; a tender set since Phase 13 Plan 08).
 *
 * One local transaction writes the sale, its lines, tenders, pending deltas,
 * the outbox row, clears the draft's tenders, and clears the cart draft. Nothing
 * is awaited from the network and nothing is printed here: a printer problem
 * must not be able to roll back a sale (D28).
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
  /** Cash handed over for CASH; the credit portion for CREDIT; 0 for a zero total. */
  amountMinor: number
  /** Server `payment.id`, for an electronic tender. Plan 09 mints these. */
  paymentId?: string | null
  providerReference?: string | null
}

export interface CompleteSaleInput {
  cart: CartState
  /** In payment order; the array index becomes `sale_tender.sequence`. */
  tenders: TenderIntent[]
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
  /** What was taken, in payment order — the receipt reloads the sale, not this. */
  tenders: Array<{ method: TenderMethod; amountMinor: number }>
}

function completionError(code: SaleCompletionCode, message: string): never {
  throw new SaleCompletionError(code, message)
}

function assertMoney(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    completionError('INVALID_TENDER', `${label} must be non-negative whole pesewas`)
  }
}

/** The draft's own validation codes, in the completion service's vocabulary. */
function completionCodeFor(error: SaleDraftError): SaleCompletionCode {
  switch (error.code) {
    case 'NO_LINES':
    case 'NO_SHIFT':
    case 'NO_CUSTOMER_FOR_CREDIT':
    case 'CASH_BELOW_TOTAL':
    case 'INVALID_TENDER':
      return error.code
    default:
      // A shared tender problem (over-paid by card, two credits, ...) is the same
      // class of client bug: the set does not balance.
      return 'INVALID_TENDER'
  }
}

/**
 * Pure preparation: validates the cart and its tender set, prices it, and builds
 * every row that will be written. No database access, so the whole contract is
 * testable.
 */
export function prepareSale(
  input: CompleteSaleInput,
  receiptNumber: string,
  occurredAt: string,
): PreparedSale {
  const { cart, tenders: intents, pricing } = input

  if (!isUuid(cart.saleId)) completionError('INVALID_CART', 'The cart has no sale id')
  if (cart.lines.length === 0) completionError('NO_LINES', 'A sale needs at least one line')
  if (!cart.shiftId) completionError('NO_SHIFT', 'Open a shift before completing a sale')

  const totals: CartTotals = computeCartTotals(cart, pricing)
  const totalMinor = totals.priced.totalMinor
  assertMoney(totalMinor, 'The sale total')
  for (const intent of intents) assertMoney(intent.amountMinor, 'A tendered amount')

  const customerId: string | null = cart.customer?.customerId ?? cart.customer?.draftId ?? null
  const zeroTotal = totalMinor === 0

  if (zeroTotal && intents.length > 0) {
    completionError('INVALID_TENDER', 'A zero-total sale takes no payment')
  }
  if (!zeroTotal && intents.length === 0) {
    completionError('INVALID_TENDER', 'A sale that owes money needs at least one payment')
  }
  if (intents.some((intent) => intent.method === 'CREDIT') && !customerId) {
    completionError('NO_CUSTOMER_FOR_CREDIT', 'A credit sale needs a customer')
  }

  // The set itself: one credit at most, credit within the total, change funded
  // by cash, and `Σ tenders − change = total`. The server asserts the same
  // identity; a mismatch here is a client bug, not a business conflict.
  const tenderDrafts: SaleTenderDraft[] = zeroTotal
    ? []
    : intents.map((intent) => ({
        method: intent.method,
        amountMinor: intent.amountMinor,
        override: intent.method === 'CREDIT' ? cart.creditOverride : null,
        paymentId: intent.paymentId ?? null,
        providerReference: intent.providerReference ?? null,
      }))
  const balance = tenderBalance(totalMinor, toTenderLines(tenderDrafts))
  if (balance.problem) {
    const cashShort =
      balance.problem === 'UNPAID_BALANCE' &&
      intents.every((intent) => intent.method === 'CASH') &&
      intents.length > 0
    completionError(
      cashShort ? 'CASH_BELOW_TOTAL' : 'INVALID_TENDER',
      balance.problem === 'UNPAID_BALANCE'
        ? cashShort
          ? 'The cash tendered is below the total'
          : 'The payments do not cover the total'
        : 'The payments do not add up to the total',
    )
  }

  let draft: SaleDraft
  try {
    draft = buildSaleDraft({
      cart,
      totals,
      cashier: input.cashier,
      shiftId: cart.shiftId,
      receiptNumber,
      tenders: tenderDrafts,
      occurredAt,
      appVersion: input.appVersion,
    })
  } catch (error) {
    if (error instanceof SaleDraftError) {
      completionError(completionCodeFor(error), error.message)
    }
    throw error
  }

  const creditAmountMinor = balance.creditMinor
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

  const tenders: SaleTenderRow[] = tenderDrafts.map((tender, index) => ({
    saleId: cart.saleId,
    sequence: index + 1,
    method: tender.method,
    amountMinor: tender.amountMinor,
    reference: null,
    paymentId: tender.paymentId,
    providerReference: tender.providerReference,
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
  // The tenders are rows on the sale now, so the draft's in-flight set has no
  // meaning: a restart must not offer to spend the same GH₵50 twice (P13-D31).
  await clearCartTenders(tx, prepared.sale.id)
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
  notifyOutboxChanged()

  return {
    saleId: prepared.sale.id,
    receiptNumber: prepared.receiptNumber,
    totalMinor: prepared.sale.totalMinor,
    changeMinor: prepared.sale.changeMinor,
    tenders: prepared.tenders.map((tender) => ({
      method: tender.method,
      amountMinor: tender.amountMinor,
    })),
  }
}
