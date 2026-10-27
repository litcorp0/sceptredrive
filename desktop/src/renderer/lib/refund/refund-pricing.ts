import { allocateProportionally, type RefundRestock } from '@sceptre/shared'
import {
  RefundError,
  type RefundRequestedLine,
  type RefundSource,
  type RefundSourceLine,
} from './refund-types'

/**
 * What a refund of `quantity` units of a line is worth, and how it splits into
 * the sale's tax components.
 *
 * The server allocates each component over the quantity **still unrefunded**
 * with weights `[requested, remaining − requested]` (Plan 05). The till has to
 * reproduce that arithmetic rather than multiply a unit price: a customer who
 * returns 1 of 3 then 2 of 3 must have had the line's whole value back, and a
 * line bought with a discount is not refundable at its list price.
 *
 * The local `refund_line` row stores only the line's total, so the earlier
 * refunds are replayed here, in order, from the sale line's stored figures. The
 * replay is deterministic, which is what makes a later refund equal the line's
 * remaining value to the pesewa.
 */

export const REFUND_COMPONENTS = [
  'baseMinor',
  'vatMinor',
  'nhilMinor',
  'getfundMinor',
  'taxTotalMinor',
  'totalMinor',
] as const

export type RefundComponent = (typeof REFUND_COMPONENTS)[number]

export type RefundComponentTotals = Record<RefundComponent, number>

export interface RefundPricedLine {
  saleLineId: string
  productId: string
  name: string
  quantity: number
  unitPriceMinor: number
  restock: RefundRestock
  damageReason: string | null
  components: RefundComponentTotals
  totalMinor: number
}

export interface RefundPricing {
  lines: RefundPricedLine[]
  totals: RefundComponentTotals
  /** The refunded total: the sum of the lines, which the tenders must equal. */
  refundedMinor: number
}

const DAMAGED_REASON_MIN = 3

function zeroComponents(): RefundComponentTotals {
  return {
    baseMinor: 0,
    vatMinor: 0,
    nhilMinor: 0,
    getfundMinor: 0,
    taxTotalMinor: 0,
    totalMinor: 0,
  }
}

/**
 * The quantity and component values a line still has after its earlier refunds.
 *
 * A drifted row (more refunded than sold) clamps at zero instead of throwing
 * mid-transaction; the cap check has already refused the request by then.
 */
export function remainingLineFigures(line: RefundSourceLine): {
  quantity: number
  components: RefundComponentTotals
} {
  let remainingQuantity = Math.max(0, line.quantity)
  const components: RefundComponentTotals = {
    baseMinor: line.baseMinor,
    vatMinor: line.vatMinor,
    nhilMinor: line.nhilMinor,
    getfundMinor: line.getfundMinor,
    taxTotalMinor: line.taxTotalMinor,
    totalMinor: line.totalMinor,
  }

  for (const prior of line.priorRefundQuantities) {
    const requested = Math.min(Math.max(0, Math.trunc(prior)), remainingQuantity)
    if (requested < 1) continue
    const weights = [requested, remainingQuantity - requested]
    for (const component of REFUND_COMPONENTS) {
      const share = allocateProportionally(components[component], weights)[0] ?? 0
      components[component] -= share
    }
    remainingQuantity -= requested
  }

  return { quantity: remainingQuantity, components }
}

/** How many units of a line a refund may still take. */
export function refundableLineQuantity(line: RefundSourceLine): number {
  return remainingLineFigures(line).quantity
}

function damageReasonProblem(
  restock: RefundRestock,
  reason: string | null,
): { code: 'DAMAGE_REASON_REQUIRED' | 'DAMAGE_REASON_NOT_ALLOWED'; message: string } | null {
  if (restock !== 'DAMAGED') {
    return reason && reason.trim().length > 0
      ? {
          code: 'DAMAGE_REASON_NOT_ALLOWED',
          message: 'Only a damaged line records a damage reason',
        }
      : null
  }
  return (reason ?? '').trim().length < DAMAGED_REASON_MIN
    ? {
        code: 'DAMAGE_REASON_REQUIRED',
        message: `Say what happened to the goods — at least ${DAMAGED_REASON_MIN} characters`,
      }
    : null
}

/**
 * Prices the requested lines, or throws `RefundError` with the reason the till
 * should show. The returned `refundedMinor` is the authority for the tender
 * allocation: a screen that shows a different number must refuse to submit.
 */
export function priceRefundLines(
  source: RefundSource,
  requested: readonly RefundRequestedLine[],
): RefundPricing {
  if (requested.length === 0) {
    throw new RefundError('NO_LINES', 'Choose at least one line to refund')
  }

  const linesById = new Map(source.lines.map((line) => [line.saleLineId, line]))
  const seen = new Set<string>()
  const totals = zeroComponents()
  const lines: RefundPricedLine[] = []

  for (const request of requested) {
    if (seen.has(request.saleLineId)) {
      throw new RefundError('INVALID_LINE', 'A sale line may appear only once on a refund')
    }
    seen.add(request.saleLineId)

    const line = linesById.get(request.saleLineId)
    if (!line) {
      throw new RefundError('INVALID_LINE', 'That line is not on this sale')
    }

    const remaining = remainingLineFigures(line)
    if (
      !Number.isSafeInteger(request.quantity) ||
      request.quantity < 1 ||
      request.quantity > remaining.quantity
    ) {
      throw new RefundError(
        'EXCEEDS_LINE',
        `Only ${remaining.quantity} of “${line.name}” can still come back`,
      )
    }

    const reasonProblem = damageReasonProblem(request.restock, request.damageReason ?? null)
    if (reasonProblem) {
      throw new RefundError(reasonProblem.code, reasonProblem.message)
    }

    const weights = [request.quantity, remaining.quantity - request.quantity]
    const components = zeroComponents()
    for (const component of REFUND_COMPONENTS) {
      components[component] =
        allocateProportionally(remaining.components[component], weights)[0] ?? 0
      totals[component] += components[component]
    }

    lines.push({
      saleLineId: line.saleLineId,
      productId: line.productId,
      name: line.name,
      quantity: request.quantity,
      unitPriceMinor: line.unitPriceMinor,
      restock: request.restock,
      damageReason: request.restock === 'DAMAGED' ? (request.damageReason?.trim() ?? null) : null,
      components,
      totalMinor: components.totalMinor,
    })
  }

  if (totals.totalMinor < 1) {
    throw new RefundError('NO_ALLOCATION', 'A refund must return a positive amount')
  }

  return { lines, totals, refundedMinor: totals.totalMinor }
}
