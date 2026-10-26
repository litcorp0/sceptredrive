import type { ApprovalReasonCode, ApprovalStatus } from '@sceptre/shared'
import type { transfer, transferLine, transferStatusEnum } from './transfers.schema.ts'

export type TransferStatus = (typeof transferStatusEnum.enumValues)[number]
export type TransferDirection = 'from' | 'to'
export type TransferRow = typeof transfer.$inferSelect
export type TransferLineRow = typeof transferLine.$inferSelect

export interface TransferLineInput {
  productId: string
  quantityRequested: number
}

export interface TransferCreateInput {
  fromBranchId: string
  toBranchId: string
  note?: string
  lines: TransferLineInput[]
}

export interface TransferUpdateInput {
  note?: string | null
}

export interface TransferLinesReplaceInput {
  lines: TransferLineInput[]
}

export interface DispatchLineInput {
  productId: string
  quantityDispatched: number
}

export interface DispatchInput {
  lines: DispatchLineInput[]
}

export interface ReceiveLineInput {
  productId: string
  quantityReceived: number
}

export interface ReceiveInput {
  lines: ReceiveLineInput[]
}

export interface ShortCloseInput {
  note: string
}

export interface TransferListQuery {
  branchId?: string
  status?: TransferStatus
  direction?: TransferDirection
  limit: number
  offset: number
}

export interface TransferListFilters {
  branchId: string | null
  status?: TransferStatus | undefined
  direction?: TransferDirection | undefined
  limit: number
  offset: number
}

export interface TransferListRow {
  id: string
  number: string
  fromBranchId: string
  fromBranchCode: string
  fromBranchName: string
  toBranchId: string
  toBranchCode: string
  toBranchName: string
  status: TransferStatus
  note: string | null
  createdBy: string | null
  dispatchedBy: string | null
  dispatchedAt: Date | null
  receivedBy: string | null
  receivedAt: Date | null
  closedBy: string | null
  closedAt: Date | null
  cancelledBy: string | null
  cancelledAt: Date | null
  createdAt: Date
  updatedAt: Date
  lineCount: number
  unitsDispatched: number
  unitsReceived: number
}

export interface TransferLineDetail extends TransferLineRow {
  sku: string
  productName: string
  pending: number
  /** On-hand at the source branch (dispatch context). */
  fromOnHand: number
  /** On-hand at the destination branch (receive context). */
  toOnHand: number
}

/**
 * The projection of one product at one branch, as the transfer module reads it:
 * on-hand for the dispatch guard and average cost for the request valuation.
 * A missing entry means the branch has never held the product (P12-D6: it
 * values at 0 and fails at dispatch on stock, which is the honest place).
 */
export interface LevelSnapshot {
  quantityOnHand: number
  avgCostMinor: number
}

/**
 * The request behind a transfer, if one was raised. A `DRAFT` transfer an admin
 * created has none; a manager's request always does (P12-D10).
 */
export interface TransferApproval {
  id: string
  status: ApprovalStatus
  requestedBy: string
  decidedBy: string | null
  decidedAt: Date | null
  decisionReasonCode: ApprovalReasonCode | null
}

export interface TransferDetail extends TransferListRow {
  lines: TransferLineDetail[]
  approval: TransferApproval | null
  /** Server-computed so the console never re-implements the dispatch rule. */
  canDispatch: boolean
}
