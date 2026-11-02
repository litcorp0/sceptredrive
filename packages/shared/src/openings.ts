/**
 * Opening-stock arithmetic and limits.
 *
 * An opening document is a **count**, not a receipt: the line stores what the shelf
 * holds, and posting computes the difference against the branch's projection at that
 * moment. Keeping the arithmetic here means the API, the console preview and the tests
 * cannot disagree about what a line is worth.
 */

/** The file cap. The target load is 250–1,000 lines; 5,000 is the same ceiling reports use. */
export const OPENING_MAX_ROWS = 5_000

export type OpeningStatus = 'DRAFT' | 'POSTED'

export interface OpeningValueLine {
  quantity: number
  unitCostMinor: number
}

export interface OpeningTotals {
  lineCount: number
  totalUnits: number
  countedValueMinor: number
  uncostedLineCount: number
}

function assertInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${label} must be a safe integer`)
  }
}

function assertNonNegative(value: number, label: string): void {
  assertInteger(value, label)
  if (value < 0) throw new TypeError(`${label} must not be negative`)
}

/** `counted × unit cost`, in integer pesewas. */
export function openingLineValueMinor(quantity: number, unitCostMinor: number): number {
  assertNonNegative(quantity, 'Opening quantity')
  assertNonNegative(unitCostMinor, 'Opening unit cost')
  return quantity * unitCostMinor
}

/**
 * The ledger delta for a counted line. Negative means the system holds more than the
 * shelf; the API refuses it because that is a shrinkage correction, not opening stock.
 */
export function openingDelta(countedQuantity: number, onHand: number): number {
  assertInteger(countedQuantity, 'Counted quantity')
  if (!Number.isSafeInteger(onHand)) throw new TypeError('On-hand quantity must be a safe integer')
  return countedQuantity - onHand
}

export function isOpeningAdditive(countedQuantity: number, onHand: number): boolean {
  return openingDelta(countedQuantity, onHand) >= 0
}

export function openingTotals(lines: ReadonlyArray<OpeningValueLine>): OpeningTotals {
  let totalUnits = 0
  let countedValueMinor = 0
  let uncostedLineCount = 0
  for (const line of lines) {
    assertNonNegative(line.quantity, 'Opening quantity')
    assertNonNegative(line.unitCostMinor, 'Opening unit cost')
    totalUnits += line.quantity
    countedValueMinor += line.quantity * line.unitCostMinor
    if (line.quantity > 0 && line.unitCostMinor === 0) uncostedLineCount += 1
  }
  return { lineCount: lines.length, totalUnits, countedValueMinor, uncostedLineCount }
}
