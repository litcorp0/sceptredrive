import type { CartTotals } from '../cart/totals'
import type { CartOverrideProof, CartState } from '../cart/types'

/**
 * The sale draft (Plan 06 Task 7).
 *
 * This is the exact object Plan 07 writes to the local sale tables and queues
 * for `POST /api/pos/sync/upload`. It is built as pure data from the cart so it
 * can be unit-tested against the server's payload contract without a database.
 *
 * Money is copied from the shared `priceCart` result — the till never
 * recomputes it here. Change is the only derived value: cash tendered minus the
 * total, exactly as the server validates it.
 */

export type TenderMethod = 'CASH' | 'CREDIT'

export interface SaleTenderDraft {
  method: TenderMethod
  /** Cash handed over for CASH; the sale total for CREDIT; 0 for a zero-total sale. */
  amountMinor: number
  override: CartOverrideProof | null
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
  tender: SaleTenderDraft
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

export class SaleDraftError extends Error {
  readonly code: 'NO_LINES' | 'NO_SHIFT' | 'NO_CUSTOMER_FOR_CREDIT' | 'CASH_BELOW_TOTAL'

  constructor(code: SaleDraftError['code'], message: string) {
    super(message)
    this.name = 'SaleDraftError'
    this.code = code
  }
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
  const { cart, totals, tender } = input
  const totalMinor = totals.priced.totalMinor

  if (cart.lines.length === 0) {
    throw new SaleDraftError('NO_LINES', 'A sale needs at least one line')
  }
  if (!input.shiftId) {
    throw new SaleDraftError('NO_SHIFT', 'Open a shift before completing a sale')
  }
  if (tender.method === 'CREDIT' && !cart.customer) {
    throw new SaleDraftError('NO_CUSTOMER_FOR_CREDIT', 'A credit sale needs a customer')
  }

  const zeroTotal = totalMinor === 0
  const isCredit = tender.method === 'CREDIT' && !zeroTotal

  if (!zeroTotal && !isCredit && tender.amountMinor < totalMinor) {
    throw new SaleDraftError('CASH_BELOW_TOTAL', 'The cash tendered is below the total')
  }

  const changeMinor = zeroTotal || isCredit ? 0 : tender.amountMinor - totalMinor

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
      tenders: zeroTotal
        ? []
        : [
            {
              method: tender.method,
              amountMinor: tender.amountMinor,
              override: toSaleProof(tender.override),
            },
          ],
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
