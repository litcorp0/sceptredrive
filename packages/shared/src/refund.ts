/**
 * A refund is a new document, never an edit to a sale (P13-D17), so its caps
 * have to be arithmetic both sides can run before money or stock moves. The
 * change a customer already received was never our money and is not refundable.
 */

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
  amountMinor: number
  refundedMinor: number
}

export function refundableTenderMinor(tender: RefundableTender): number {
  return Math.max(0, tender.amountMinor - tender.refundedMinor)
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
 * The last check is why the sale's change is an input: it caps the refund at
 * `tenderTotal - change`, so change can never be handed back twice.
 */
export function refundAllocationProblem(input: {
  allocation: RefundAllocation
  lines: readonly RefundableSaleLine[]
  tenders: readonly RefundableTender[]
  refundedMinor: number
  saleTenderTotalMinor: number
  saleChangeMinor: number
}): RefundAllocationProblem | null {
  const { allocation, lines, tenders, refundedMinor } = input

  if (refundedMinor < 1 || allocation.lines.length === 0 || allocation.tenders.length === 0) {
    return 'NO_ALLOCATION'
  }

  const linesById = new Map(lines.map((line) => [line.saleLineId, line]))
  for (const allocated of allocation.lines) {
    const line = linesById.get(allocated.saleLineId)
    const cap = line ? refundableQuantity(line) : 0
    if (
      !Number.isSafeInteger(allocated.quantity) ||
      allocated.quantity < 1 ||
      allocated.quantity > cap
    ) {
      return 'EXCEEDS_LINE'
    }
  }

  const tendersById = new Map(tenders.map((tender) => [tender.saleTenderId, tender]))
  let allocatedMinor = 0
  for (const allocated of allocation.tenders) {
    const tender = tendersById.get(allocated.saleTenderId)
    const cap = tender ? refundableTenderMinor(tender) : 0
    if (
      !Number.isSafeInteger(allocated.amountMinor) ||
      allocated.amountMinor < 1 ||
      allocated.amountMinor > cap
    ) {
      return 'EXCEEDS_TENDER'
    }
    allocatedMinor += allocated.amountMinor
  }

  if (allocatedMinor !== refundedMinor) {
    return 'SUM_MISMATCH'
  }

  if (refundedMinor > input.saleTenderTotalMinor - input.saleChangeMinor) {
    return 'EXCEEDS_SALE'
  }

  return null
}

/** `>=` — a refund of exactly the cap needs an approval (P13-D21). */
export function refundApprovalRequired(refundedMinor: number, thresholdMinor: number): boolean {
  return refundedMinor >= thresholdMinor
}
