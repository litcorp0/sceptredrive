function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`)
  }
}

/**
 * Per-branch weighted moving average after an inbound movement that carries a
 * known unit cost (goods receipt or transfer-in).
 *
 * When the branch is at or below zero on hand, the old average is meaningless:
 * the incoming cost replaces it outright (standard WAC rule, no divide-by-zero).
 * Otherwise the incoming value blends with the current stock value and the
 * result is rounded half-up to whole pesewas.
 */
export function averageCostAfterReceipt(
  currentAvgCostMinor: number,
  currentQty: number,
  receivedUnitCostMinor: number,
  receivedQty: number,
): number {
  assertNonNegativeInteger(currentAvgCostMinor, 'Current average cost')
  assertNonNegativeInteger(receivedUnitCostMinor, 'Received unit cost')
  if (!Number.isSafeInteger(currentQty)) {
    throw new TypeError('Current quantity must be a safe integer')
  }
  if (!Number.isSafeInteger(receivedQty) || receivedQty <= 0) {
    throw new TypeError('Received quantity must be a positive safe integer')
  }

  if (currentQty <= 0) return receivedUnitCostMinor

  return Math.round(
    (currentAvgCostMinor * currentQty + receivedUnitCostMinor * receivedQty) /
      (currentQty + receivedQty),
  )
}
