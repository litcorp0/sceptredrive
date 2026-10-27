/**
 * A refund is a new document, never an edit to a sale (P13-D17), so its caps
 * have to be arithmetic both sides can run before money or stock moves. The
 * change a customer already received was never our money and is not refundable.
 */

import type { TenderMethod } from './tender.ts'

export const REFUND_REASONS = [
  'CUSTOMER_CHANGED_MIND',
  'WRONG_ITEM',
  'DEFECTIVE',
  'PRICE_DISPUTE',
  'DUPLICATE_SALE',
  'OTHER',
] as const
export type RefundReason = (typeof REFUND_REASONS)[number]

export const REFUND_REASON_LABELS: Record<RefundReason, string> = {
  CUSTOMER_CHANGED_MIND: 'Customer changed their mind',
  WRONG_ITEM: 'Wrong item',
  DEFECTIVE: 'Defective item',
  PRICE_DISPUTE: 'Price dispute',
  DUPLICATE_SALE: 'Duplicate sale',
  OTHER: 'Other',
}

export const REFUND_RESTOCK_OPTIONS = ['RESALABLE', 'DAMAGED', 'NOT_RETURNED'] as const
export type RefundRestock = (typeof REFUND_RESTOCK_OPTIONS)[number]

export const REFUND_RESTOCK_LABELS: Record<RefundRestock, string> = {
  RESALABLE: 'Resalable',
  DAMAGED: 'Damaged',
  NOT_RETURNED: 'Not returned',
}

/** `RESALABLE` is the only option that moves stock back in (P13-D22). */
export function movesStockBack(restock: RefundRestock): boolean {
  return restock === 'RESALABLE'
}

/** `DAMAGED` is the only option that insists on a reason (P13-D22). */
export function restockRequiresReason(restock: RefundRestock): boolean {
  return restock === 'DAMAGED'
}

export interface RefundableSaleLine {
  saleLineId: string
  quantity: number
  refundedQuantity: number
}

export function refundableQuantity(line: RefundableSaleLine): number {
  return Math.max(0, line.quantity - line.refundedQuantity)
}

export interface RefundableTender {
  saleTenderId: string
  method: TenderMethod
  amountMinor: number
  refundedMinor: number
}

/**
 * The part of each tender a refund may still return, in the given order.
 *
 * Change only ever comes out of cash (P13-D3), so a sale's change is consumed
 * once from its cash tenders in row order: each cash row absorbs up to its own
 * remainder and the rest passes to the next. Non-cash rows are untouched.
 * Use this whenever a sale has more than one tender; netting the whole change
 * off every cash row would understate the caps and refuse a legitimate refund.
 */
export function refundableTenderRemainders(
  tenders: readonly RefundableTender[],
  saleChangeMinor = 0,
): Array<{ saleTenderId: string; refundableMinor: number }> {
  let remainingChange = Math.max(0, saleChangeMinor)
  return tenders.map((tender) => {
    const rawCap = Math.max(0, tender.amountMinor - tender.refundedMinor)
    if (tender.method !== 'CASH' || remainingChange === 0) {
      return { saleTenderId: tender.saleTenderId, refundableMinor: rawCap }
    }
    const absorbed = Math.min(remainingChange, rawCap)
    remainingChange -= absorbed
    return { saleTenderId: tender.saleTenderId, refundableMinor: rawCap - absorbed }
  })
}

/**
 * The part of a single tender a refund may still return.
 *
 * Change only ever comes out of cash (P13-D3), so a cash tender that produced
 * change kept less than it took in. Pass `saleChangeMinor` and the cash
 * remainder is netted down; a no-change sale can leave it out.
 *
 * This assumes the tender is the sale's only cash tender, because it subtracts
 * the whole `saleChangeMinor` from it; a caller with several must use
 * `refundableTenderRemainders`, which consumes the change once across rows.
 */
export function refundableTenderMinor(tender: RefundableTender, saleChangeMinor = 0): number {
  return refundableTenderRemainders([tender], saleChangeMinor)[0]?.refundableMinor ?? 0
}

export type RefundAllocationProblem =
  | 'EXCEEDS_LINE'
  | 'EXCEEDS_TENDER'
  | 'SUM_MISMATCH'
  | 'EXCEEDS_SALE'
  | 'NO_ALLOCATION'

export interface RefundAllocation {
  lines: Array<{ saleLineId: string; quantity: number }>
  tenders: Array<{ saleTenderId: string; amountMinor: number }>
}

/**
 * Checks a proposed refund allocation, in the order the till should explain it
 * (P13-D19): a line, then a tender, then the document's own sum, then the sale.
 *
 * Rows are totalled per `saleLineId` and per `saleTenderId` before any cap is
 * compared, so one document cannot refund the same line or tender twice by
 * splitting it across rows.
 *
 * Tender remainders must already reflect every earlier refund; the caller
 * supplies that in each `RefundableTender`. `refundableTenderRemainders` also
 * nets the sale's change once across the cash tenders, which makes the
 * per-tender caps enforce the sale cap by construction. The sale-level check
 * stays as the second line of defence: it compares
 * `previouslyRefundedMinor + refundedMinor` with
 * `saleTenderTotalMinor - saleChangeMinor`, catching tender data that does not
 * add up.
 */
export function refundAllocationProblem(input: {
  allocation: RefundAllocation
  lines: readonly RefundableSaleLine[]
  tenders: readonly RefundableTender[]
  refundedMinor: number
  saleTenderTotalMinor: number
  saleChangeMinor: number
  /** Already refunded on earlier documents for this sale; defaults to zero. */
  previouslyRefundedMinor?: number
}): RefundAllocationProblem | null {
  const {
    allocation,
    lines,
    tenders,
    refundedMinor,
    saleTenderTotalMinor,
    saleChangeMinor,
    previouslyRefundedMinor = 0,
  } = input

  if (!Number.isSafeInteger(previouslyRefundedMinor) || previouslyRefundedMinor < 0) {
    throw new RangeError('Previously refunded amount must be a non-negative integer')
  }

  if (refundedMinor < 1 || allocation.lines.length === 0 || allocation.tenders.length === 0) {
    return 'NO_ALLOCATION'
  }

  const linesById = new Map(lines.map((line) => [line.saleLineId, line]))
  const quantityByLine = new Map<string, number>()
  for (const allocated of allocation.lines) {
    if (!Number.isSafeInteger(allocated.quantity) || allocated.quantity < 1) {
      return 'EXCEEDS_LINE'
    }
    quantityByLine.set(
      allocated.saleLineId,
      (quantityByLine.get(allocated.saleLineId) ?? 0) + allocated.quantity,
    )
  }
  for (const [saleLineId, quantity] of quantityByLine) {
    const line = linesById.get(saleLineId)
    const cap = line ? refundableQuantity(line) : 0
    if (!Number.isSafeInteger(quantity) || quantity > cap) {
      return 'EXCEEDS_LINE'
    }
  }

  const capsById = new Map(
    refundableTenderRemainders(tenders, saleChangeMinor).map((row) => [
      row.saleTenderId,
      row.refundableMinor,
    ]),
  )
  const amountByTender = new Map<string, number>()
  let allocatedMinor = 0
  for (const allocated of allocation.tenders) {
    if (!Number.isSafeInteger(allocated.amountMinor) || allocated.amountMinor < 1) {
      return 'EXCEEDS_TENDER'
    }
    amountByTender.set(
      allocated.saleTenderId,
      (amountByTender.get(allocated.saleTenderId) ?? 0) + allocated.amountMinor,
    )
    allocatedMinor += allocated.amountMinor
  }
  for (const [saleTenderId, amountMinor] of amountByTender) {
    const cap = capsById.get(saleTenderId) ?? 0
    if (!Number.isSafeInteger(amountMinor) || amountMinor > cap) {
      return 'EXCEEDS_TENDER'
    }
  }

  if (!Number.isSafeInteger(allocatedMinor) || allocatedMinor !== refundedMinor) {
    return 'SUM_MISMATCH'
  }

  if (previouslyRefundedMinor + refundedMinor > saleTenderTotalMinor - saleChangeMinor) {
    return 'EXCEEDS_SALE'
  }

  return null
}

/** `>=` — a refund of exactly the cap needs an approval (P13-D21). */
export function refundApprovalRequired(refundedMinor: number, thresholdMinor: number): boolean {
  if (!Number.isSafeInteger(refundedMinor) || refundedMinor < 0) {
    throw new RangeError('Refund amount must be a non-negative integer')
  }
  if (!Number.isSafeInteger(thresholdMinor) || thresholdMinor < 0) {
    throw new RangeError('Approval threshold must be a non-negative integer')
  }
  return refundedMinor >= thresholdMinor
}
