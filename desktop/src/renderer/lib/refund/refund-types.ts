import type { RefundRestock, TenderMethod } from '@sceptre/shared'

/**
 * The shapes a refund is built from on the till (Plan 10).
 *
 * A refund is a document over a sale this terminal already wrote, so the till
 * reads the sale's own rows and the refunds already booked against it — never a
 * server answer (P13-D17/D25). Everything here is local and works unplugged.
 */

export type RefundErrorCode =
  | 'SALE_NOT_FOUND'
  | 'FOREIGN_SALE'
  | 'NOT_SIGNED_IN'
  | 'SHIFT_REQUIRED'
  | 'SELF_APPROVAL'
  | 'NO_LINES'
  | 'INVALID_LINE'
  | 'EXCEEDS_LINE'
  | 'EXCEEDS_TENDER'
  | 'EXCEEDS_SALE'
  | 'SUM_MISMATCH'
  | 'NO_ALLOCATION'
  | 'INVALID_TENDER'
  | 'DAMAGE_REASON_REQUIRED'
  | 'DAMAGE_REASON_NOT_ALLOWED'
  | 'NOTE_REQUIRED'
  | 'INVALID_REASON'

export class RefundError extends Error {
  readonly code: RefundErrorCode

  constructor(code: RefundErrorCode, message: string) {
    super(message)
    this.name = 'RefundError'
    this.code = code
  }
}

export interface RefundSourceLine {
  saleLineId: string
  lineNumber: number
  productId: string
  name: string
  quantity: number
  unitPriceMinor: number
  taxCategory: string
  baseMinor: number
  vatMinor: number
  nhilMinor: number
  getfundMinor: number
  taxTotalMinor: number
  totalMinor: number
  /**
   * The quantity of each earlier refund of this line, oldest first.
   *
   * The order matters: the component allocation is replayed in the order it was
   * consumed, so the last unit of a line takes that line's exact remainder and
   * every refund of the line telescopes to its stored figures.
   */
  priorRefundQuantities: number[]
}

export interface RefundSourceTender {
  saleTenderId: string
  sequence: number
  method: TenderMethod
  amountMinor: number
  /** Electronic tenders carry the server payment their refund dispatches against. */
  paymentId: string | null
  alreadyRefundedMinor: number
  /** Already net of the sale's change, which was never money the shop kept. */
  refundableMinor: number
}

export interface RefundSource {
  saleId: string
  receiptNumber: string
  terminalId: string
  shiftId: string
  occurredAt: string
  taxMode: string
  customerName: string | null
  totalMinor: number
  tenderTotalMinor: number
  changeMinor: number
  previouslyRefundedMinor: number
  lines: RefundSourceLine[]
  tenders: RefundSourceTender[]
}

/** A search hit: enough to choose a receipt without loading the whole document. */
export interface SaleSearchRow {
  saleId: string
  receiptNumber: string
  occurredAt: string
  totalMinor: number
  refundedMinor: number
  /** What could still come back; zero means the sale is fully refunded. */
  refundableMinor: number
  customerName: string | null
}

export interface RefundRequestedLine {
  saleLineId: string
  quantity: number
  restock: RefundRestock
  damageReason?: string | null
}

export interface RefundRequestedTender {
  saleTenderId: string
  amountMinor: number
}

/** Anything a repository query can run against: the database or an open transaction. */
export interface RefundReader {
  getOptional<T>(sql: string, parameters?: unknown[]): Promise<T | null>
  getAll<T>(sql: string, parameters?: unknown[]): Promise<T[]>
}
