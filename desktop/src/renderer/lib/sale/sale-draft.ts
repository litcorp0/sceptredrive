import {
  changeFromCash,
  isTenderMethod,
  TENDER_PROBLEM_MESSAGES,
  type TenderLine,
  type TenderMethod,
  type TenderProblem,
  tenderBalance,
} from '@sceptre/shared'
import type { CartTotals } from '../cart/totals'
import type { CartOverrideProof, CartState } from '../cart/types'

/**
 * The sale draft (Plan 06 Task 7, a tender set since Phase 13 Plan 08).
 *
 * This is the exact object Plan 07 writes to the local sale tables and queues
 * for `POST /api/pos/sync/upload`. It is built as pure data from the cart so it
 * can be unit-tested against the server's payload contract without a database.
 *
 * Money is copied from the shared `priceCart` result — the till never
 * recomputes it here. The tender arithmetic is not ours either: `tenderBalance`
 * and `changeFromCash` are the functions the server asserts with (P13-D3), so a
 * split cannot balance at the till and fail on upload.
 */

export type { TenderMethod }

/**
 * The tender vocabulary lives in `@sceptre/shared` because both sides read the
 * same stored value. Reading it back is therefore a parse, never a guess: a
 * stored `MOMO` that this build does not know is an error, not cash.
 */
export function parseTenderMethod(value: string): TenderMethod {
  if (isTenderMethod(value)) return value
  throw new SaleDraftError('INVALID_TENDER', `Unknown tender method: ${value}`)
}

export interface SaleTenderDraft {
  method: TenderMethod
  amountMinor: number
  /** Only a credit tender carries one: it is the manager's proof for the debt. */
  override: CartOverrideProof | null
  /** Server `payment.id` for an electronic tender; null for cash and credit. */
  paymentId: string | null
  /** The provider's own reference, printed on a reprint after the sale uploads. */
  providerReference: string | null
}

export interface SaleCashierDraft {
  userId: string
  staffId: string
  bindingId: string
  /** Server binding credential; travels only inside the device-authenticated upload. */
  bindingToken: string
  pinVersion: number
}

export interface SaleDraftInput {
  cart: CartState
  totals: CartTotals
  cashier: SaleCashierDraft
  shiftId: string
  receiptNumber: string
  /** In payment order; the array index is the tender's `sequence`. */
  tenders: SaleTenderDraft[]
  occurredAt: string
  appVersion?: string
}

/** Mirrors `salePayloadSchema` in the API's sync validation. */
export interface SalePayloadDraft {
  receiptNumber: string
  shiftId: string
  cashier: {
    userId: string
    staffId: string
    bindingId: string
    bindingToken: string
    pinVersion: number
  }
  customer: { id: string; phone: string; name?: string } | null
  lines: Array<{
    productId: string
    quantity: number
    unitPriceMinor: number
    lineDiscountMinor: number
    taxCategory: string
  }>
  saleDiscount: {
    amountMinor: number
    reasonCode: string
    note: string | null
    override: SaleProof | null
  } | null
  loyalty: { redeemPoints: number; earnPreviewPoints: number } | null
  /**
   * In payment order. `paymentId`/`providerReference` stay on the device rows
   * until Plan 09 adds them to the wire alongside the electronic methods: the
   * current schema is `.strict()`, so sending them early is a 400.
   */
  tenders: Array<{
    method: TenderMethod
    amountMinor: number
    override: SaleProof | null
  }>
  totals: {
    subtotalMinor: number
    lineDiscountMinor: number
    saleDiscountMinor: number
    loyaltyDiscountMinor: number
    vatMinor: number
    nhilMinor: number
    getfundMinor: number
    taxTotalMinor: number
    totalMinor: number
    changeMinor: number
  }
  occurredAt: string
  appVersion?: string
}

export interface SaleProof {
  staffId: string
  userId: string
  bindingId: string
  pinVersion: number
  reasonCode: string
  note: string | null
  occurredAt: string
}

export interface SaleDraft {
  clientTransactionId: string
  occurredAt: string
  payloadVersion: 1
  type: 'SALE'
  payload: SalePayloadDraft
}

export type SaleDraftErrorCode =
  | 'NO_LINES'
  | 'NO_SHIFT'
  | 'NO_CUSTOMER_FOR_CREDIT'
  | 'CASH_BELOW_TOTAL'
  | 'INVALID_TENDER'
  | TenderProblem

export class SaleDraftError extends Error {
  readonly code: SaleDraftErrorCode

  constructor(code: SaleDraftErrorCode, message: string) {
    super(message)
    this.name = 'SaleDraftError'
    this.code = code
  }
}

/**
 * A tender set's problem code, in the words this screen has always used.
 *
 * A single cash tender that is short keeps Phase 6's `CASH_BELOW_TOTAL`: the
 * cashier typed too little cash, and "there is still an unpaid balance" would be
 * a worse sentence for it. Every other problem keeps the shared code, so the
 * message and the rule are the same on both sides.
 */
function tenderProblemCode(
  problem: TenderProblem,
  tenders: readonly SaleTenderDraft[],
): SaleDraftErrorCode {
  if (problem === 'UNPAID_BALANCE' && tenders.every((tender) => tender.method === 'CASH')) {
    return 'CASH_BELOW_TOTAL'
  }
  return problem
}

const PROBLEM_MESSAGES = TENDER_PROBLEM_MESSAGES

/** The tender lines in payment order, which is what `sequence` records. */
export function toTenderLines(tenders: readonly SaleTenderDraft[]): TenderLine[] {
  return tenders.map((tender, index) => ({
    method: tender.method,
    amountMinor: tender.amountMinor,
    sequence: index + 1,
  }))
}

/** The server's override proof shape (no role, no binding token). */
export function toSaleProof(proof: CartOverrideProof | null): SaleProof | null {
  if (!proof) return null
  return {
    staffId: proof.approverStaffId,
    userId: proof.approverUserId,
    bindingId: proof.bindingId,
    pinVersion: proof.pinVersion,
    reasonCode: proof.reasonCode,
    note: proof.note,
    occurredAt: proof.approvedAt,
  }
}

/**
 * The upload contract has one override slot: `saleDiscount.override`. When the
 * approval was for a line discount, the proof rides on a zero-amount sale
 * discount so the server can still validate it.
 */
function saleDiscountFor(cart: CartState): SalePayloadDraft['saleDiscount'] {
  if (cart.saleDiscount) {
    return {
      amountMinor: cart.saleDiscount.amountMinor,
      reasonCode: cart.saleDiscount.reasonCode,
      note: cart.saleDiscount.note,
      override: toSaleProof(cart.saleDiscount.override),
    }
  }

  const lineApproval = cart.lines.find((line) => line.discountOverride)?.discountOverride ?? null
  if (lineApproval) {
    return {
      amountMinor: 0,
      reasonCode: 'OTHER',
      note: 'Line discount approved',
      override: toSaleProof(lineApproval),
    }
  }

  return null
}

export function buildSaleDraft(input: SaleDraftInput): SaleDraft {
  const { cart, totals, tenders } = input
  const totalMinor = totals.priced.totalMinor

  if (cart.lines.length === 0) {
    throw new SaleDraftError('NO_LINES', 'A sale needs at least one line')
  }
  if (!input.shiftId) {
    throw new SaleDraftError('NO_SHIFT', 'Open a shift before completing a sale')
  }
  if (tenders.some((tender) => tender.method === 'CREDIT') && !cart.customer) {
    throw new SaleDraftError('NO_CUSTOMER_FOR_CREDIT', 'A credit sale needs a customer')
  }
  // Only the credit tender may carry a manager proof; a PIN on cash would be an
  // approval of nothing (P13-D4).
  if (tenders.some((tender) => tender.method !== 'CREDIT' && tender.override)) {
    throw new SaleDraftError('INVALID_TENDER', 'Only a credit payment can carry an approval')
  }

  const zeroTotal = totalMinor === 0
  if (zeroTotal && tenders.length > 0) {
    throw new SaleDraftError('INVALID_TENDER', 'A zero-total sale takes no payment')
  }
  const lines = toTenderLines(tenders)
  const problem = tenderBalance(totalMinor, lines).problem
  if (problem) {
    throw new SaleDraftError(tenderProblemCode(problem, tenders), PROBLEM_MESSAGES[problem])
  }

  const changeMinor = zeroTotal ? 0 : changeFromCash(totalMinor, lines)

  const customer = cart.customer
    ? cart.customer.isDraft && cart.customer.draftId
      ? {
          id: cart.customer.draftId,
          phone: cart.customer.phone,
          name: cart.customer.name,
        }
      : cart.customer.customerId
        ? { id: cart.customer.customerId, phone: cart.customer.phone }
        : null
    : null

  return {
    clientTransactionId: cart.saleId,
    occurredAt: input.occurredAt,
    payloadVersion: 1,
    type: 'SALE',
    payload: {
      receiptNumber: input.receiptNumber,
      shiftId: input.shiftId,
      cashier: {
        userId: input.cashier.userId,
        staffId: input.cashier.staffId,
        bindingId: input.cashier.bindingId,
        bindingToken: input.cashier.bindingToken,
        pinVersion: input.cashier.pinVersion,
      },
      customer,
      lines: cart.lines.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        unitPriceMinor: line.unitPriceMinor,
        lineDiscountMinor: line.lineDiscountMinor,
        taxCategory: line.taxCategory,
      })),
      saleDiscount: saleDiscountFor(cart),
      loyalty:
        cart.customer && (cart.loyaltyRedeemPoints > 0 || totals.earnPreviewPoints > 0)
          ? {
              redeemPoints: cart.loyaltyRedeemPoints,
              earnPreviewPoints: totals.earnPreviewPoints,
            }
          : null,
      tenders: tenders.map((tender) => ({
        method: tender.method,
        amountMinor: tender.amountMinor,
        override: toSaleProof(tender.override),
      })),
      totals: {
        subtotalMinor: totals.priced.subtotalMinor,
        lineDiscountMinor: totals.priced.lineDiscountMinor,
        saleDiscountMinor: totals.priced.saleDiscountMinor,
        loyaltyDiscountMinor: totals.priced.loyaltyDiscountMinor,
        vatMinor: totals.priced.vatMinor,
        nhilMinor: totals.priced.nhilMinor,
        getfundMinor: totals.priced.getfundMinor,
        taxTotalMinor: totals.priced.taxTotalMinor,
        totalMinor,
        changeMinor,
      },
      occurredAt: input.occurredAt,
      appVersion: input.appVersion,
    },
  }
}
