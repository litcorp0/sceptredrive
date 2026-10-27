/**
 * Tender arithmetic is the one number the till and the server must never
 * disagree about. It lives beside the pricing engine rather than inside it:
 * the method list grows with the payment providers, while pricing must not.
 */

export const TENDER_METHODS = ['CASH', 'CREDIT', 'MOMO', 'CARD', 'BANK_TRANSFER'] as const
export type TenderMethod = (typeof TENDER_METHODS)[number]

export const ELECTRONIC_TENDER_METHODS = ['MOMO', 'CARD', 'BANK_TRANSFER'] as const
export type ElectronicTenderMethod = (typeof ELECTRONIC_TENDER_METHODS)[number]

const TENDER_METHOD_SET: ReadonlySet<string> = new Set(TENDER_METHODS)
const ELECTRONIC_TENDER_SET: ReadonlySet<string> = new Set(ELECTRONIC_TENDER_METHODS)

export function isTenderMethod(value: string): value is TenderMethod {
  return TENDER_METHOD_SET.has(value)
}

export function isElectronicTender(method: TenderMethod): method is ElectronicTenderMethod {
  return ELECTRONIC_TENDER_SET.has(method)
}

/** A payload and UI limit, not a database rule (P13-D1). */
export const MAX_TENDERS_PER_SALE = 5

export interface TenderLine {
  method: TenderMethod
  amountMinor: number
  sequence: number
}

export type TenderProblem =
  | 'NEGATIVE_TENDER'
  | 'TOO_MANY_TENDERS'
  | 'MULTIPLE_CREDIT_TENDERS'
  | 'CREDIT_EXCEEDS_TOTAL'
  | 'OVERPAID_BY_ELECTRONIC'
  | 'UNPAID_BALANCE'

export interface TenderBalance {
  totalMinor: number
  appliedMinor: number
  cashMinor: number
  creditMinor: number
  electronicMinor: number
  remainingMinor: number
  changeMinor: number
  problem: TenderProblem | null
}

export const TENDER_PROBLEM_MESSAGES: Record<TenderProblem, string> = {
  NEGATIVE_TENDER: 'Each payment must be a positive amount',
  TOO_MANY_TENDERS: 'A sale can carry at most five payments',
  MULTIPLE_CREDIT_TENDERS: 'Only one credit payment is allowed per sale',
  CREDIT_EXCEEDS_TOTAL: 'Credit cannot be more than the sale total',
  OVERPAID_BY_ELECTRONIC: 'Electronic payments cannot exceed what is owed; give change from cash',
  UNPAID_BALANCE: 'There is still an unpaid balance',
}

export const TENDER_LABELS: Record<TenderMethod, string> = {
  CASH: 'Cash',
  CREDIT: 'Credit',
  MOMO: 'MoMo',
  CARD: 'Card',
  BANK_TRANSFER: 'Bank transfer',
}

export function formatTenderLabel(method: TenderMethod): string {
  return TENDER_LABELS[method]
}

interface TenderTotals {
  appliedMinor: number
  cashMinor: number
  creditMinor: number
  electronicMinor: number
}

function balance(
  totalMinor: number,
  totals: TenderTotals,
  changeMinor: number,
  problem: TenderProblem | null,
): TenderBalance {
  return {
    totalMinor,
    appliedMinor: totals.appliedMinor,
    cashMinor: totals.cashMinor,
    creditMinor: totals.creditMinor,
    electronicMinor: totals.electronicMinor,
    remainingMinor: Math.max(0, totalMinor - totals.appliedMinor),
    changeMinor,
    problem,
  }
}

/**
 * Judges a tender set against a sale total (P13-D3).
 *
 * Change is `max(0, applied - total)` but may only be funded by cash: if it
 * exceeds the cash tender the set is impossible and the change is reported as
 * zero, because a caller must not read a plausible number off an impossible
 * tender set. A problem code is returned for every business condition; only a
 * duplicate sequence throws, because no screen can produce one.
 */
export function tenderBalance(totalMinor: number, tenders: readonly TenderLine[]): TenderBalance {
  const sequences = new Set<number>()
  for (const tender of tenders) {
    if (sequences.has(tender.sequence)) {
      throw new RangeError(`Duplicate tender sequence: ${tender.sequence}`)
    }
    sequences.add(tender.sequence)
  }

  const totals: TenderTotals = {
    appliedMinor: 0,
    cashMinor: 0,
    creditMinor: 0,
    electronicMinor: 0,
  }
  let creditCount = 0
  let hasInvalidAmount = false

  for (const tender of tenders) {
    const amountMinor = tender.amountMinor
    if (!Number.isSafeInteger(amountMinor) || amountMinor < 1) hasInvalidAmount = true

    totals.appliedMinor += amountMinor
    if (tender.method === 'CASH') {
      totals.cashMinor += amountMinor
    } else if (tender.method === 'CREDIT') {
      totals.creditMinor += amountMinor
      creditCount += 1
    } else if (isElectronicTender(tender.method)) {
      totals.electronicMinor += amountMinor
    }
  }

  if (tenders.length > MAX_TENDERS_PER_SALE) {
    return balance(totalMinor, totals, 0, 'TOO_MANY_TENDERS')
  }
  if (hasInvalidAmount) {
    return balance(totalMinor, totals, 0, 'NEGATIVE_TENDER')
  }
  if (creditCount > 1) {
    return balance(totalMinor, totals, 0, 'MULTIPLE_CREDIT_TENDERS')
  }
  if (totalMinor === 0 && tenders.length > 0) {
    return balance(totalMinor, totals, 0, 'UNPAID_BALANCE')
  }
  if (totals.creditMinor > totalMinor) {
    return balance(totalMinor, totals, 0, 'CREDIT_EXCEEDS_TOTAL')
  }

  const changeMinor = Math.max(0, totals.appliedMinor - totalMinor)
  if (changeMinor > totals.cashMinor) {
    return balance(totalMinor, totals, 0, 'OVERPAID_BY_ELECTRONIC')
  }
  if (totals.appliedMinor < totalMinor) {
    return balance(totalMinor, totals, changeMinor, 'UNPAID_BALANCE')
  }

  return balance(totalMinor, totals, changeMinor, null)
}

/** The drawer movement for a tender set; zero when the set is impossible. */
export function changeFromCash(totalMinor: number, tenders: readonly TenderLine[]): number {
  return tenderBalance(totalMinor, tenders).changeMinor
}
