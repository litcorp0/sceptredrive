/**
 * Purchase-order arithmetic and the one transition table.
 *
 * The service enforces this table; the console renders its buttons from the
 * server's `canApply`, which is computed from the same function. Two clients
 * cannot disagree about what is allowed next if there is only one answer.
 */

export const PURCHASE_ORDER_STATUSES = [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'SENT',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CLOSED',
  'CANCELLED',
] as const

export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number]

export type PurchaseOrderAction = 'submit' | 'send' | 'receive' | 'close' | 'cancel'

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`)
  }
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`)
  }
}

/**
 * The goods value of an order in integer minor units: Σ quantity × unit cost.
 *
 * This is the figure the approval threshold compares against (ex-tax; input VAT
 * is recoverable, so the commitment being approved is the cost of the goods).
 * It is never stored on the order — a stored total drifts on every draft edit.
 */
export function goodsValueMinor(
  lines: readonly { quantity: number; unitCostMinor: number }[],
): number {
  let total = 0
  for (const line of lines) {
    assertPositiveInteger(line.quantity, 'Line quantity')
    assertNonNegativeInteger(line.unitCostMinor, 'Line unit cost')
    total += line.quantity * line.unitCostMinor
    if (!Number.isSafeInteger(total)) {
      throw new TypeError('Order value is too large to represent safely')
    }
  }
  return total
}

/**
 * At or above the branch threshold a human decides; below it a manager's order
 * is approved automatically. "At" counts as above — a limit that can be reached
 * exactly is not a limit.
 */
export function requiresApproval(goodsValue: number, thresholdMinor: number): boolean {
  assertNonNegativeInteger(goodsValue, 'Goods value')
  assertNonNegativeInteger(thresholdMinor, 'Approval threshold')
  return goodsValue >= thresholdMinor
}

const TRANSITIONS: Record<PurchaseOrderStatus, readonly PurchaseOrderAction[]> = {
  DRAFT: ['submit', 'cancel'],
  PENDING_APPROVAL: ['cancel'],
  APPROVED: ['send', 'receive', 'close', 'cancel'],
  // `cancel` is listed for SENT because the service allows it only while nothing
  // has been received; the receipt count is not a pure-function input.
  SENT: ['receive', 'close', 'cancel'],
  PARTIALLY_RECEIVED: ['receive', 'close'],
  RECEIVED: ['close'],
  REJECTED: [],
  CLOSED: [],
  CANCELLED: [],
}

/** False rather than an exception: a screen asks this on every render. */
export function canApplyOrderAction(
  status: PurchaseOrderStatus,
  action: PurchaseOrderAction,
): boolean {
  return TRANSITIONS[status].includes(action)
}

export interface OrderFulfilmentLine {
  ordered: number
  received: number
}

export interface OrderFulfilment {
  anyReceived: boolean
  allReceived: boolean
  /** True when any line received more than was ordered. */
  overReceived: boolean
}

/**
 * What a receipt does to an order's status.
 *
 * `received` is the cumulative quantity including the receipt being posted.
 * A partially received order never returns to SENT: once goods arrived, the
 * order is part-received even if a later receipt completes it.
 */
export function orderFulfilment(lines: readonly OrderFulfilmentLine[]): OrderFulfilment {
  let anyReceived = false
  let allReceived = lines.length > 0
  let overReceived = false

  for (const line of lines) {
    assertPositiveInteger(line.ordered, 'Ordered quantity')
    assertNonNegativeInteger(line.received, 'Received quantity')

    if (line.received > 0) anyReceived = true
    if (line.received < line.ordered) allReceived = false
    if (line.received > line.ordered) overReceived = true
  }

  return { anyReceived, allReceived, overReceived }
}
