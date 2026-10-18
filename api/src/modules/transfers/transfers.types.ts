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

export interface TransferDetail extends TransferListRow {
  lines: TransferLineDetail[]
}
