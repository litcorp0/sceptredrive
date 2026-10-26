import type { ApprovalReasonCode, ApprovalStatus } from '@sceptre/shared'
import type {
  stockWriteOff,
  stockWriteOffLine,
  stockWriteOffStatusEnum,
} from './writeoffs.schema.ts'
import { stockWriteOffReasonEnum } from './writeoffs.schema.ts'

/**
 * The form's reason vocabulary, derived from the database enum so the request
 * schema, the service and the column can never disagree. It is deliberately not
 * merged with `stock_adjustment_reason`: the ledger's list describes what the
 * stock did, this one describes why the goods left (P12-D15, P12-D16).
 */
export const STOCK_WRITE_OFF_REASONS = stockWriteOffReasonEnum.enumValues

export type StockWriteOffReason = (typeof stockWriteOffReasonEnum.enumValues)[number]
export type StockWriteOffStatus = (typeof stockWriteOffStatusEnum.enumValues)[number]

export type WriteOffRow = typeof stockWriteOff.$inferSelect
export type WriteOffLineRow = typeof stockWriteOffLine.$inferSelect

export interface WriteOffLineInput {
  productId: string
  quantity: number
  reason: StockWriteOffReason
  note?: string
}

export interface WriteOffCreateInput {
  lines: WriteOffLineInput[]
  note?: string
}

export interface WriteOffListQuery {
  branchId?: string
  status?: StockWriteOffStatus
  limit: number
  offset: number
}

export interface WriteOffListFilters {
  branchId: string | null
  status?: StockWriteOffStatus | undefined
  limit: number
  offset: number
}

/**
 * One line as the decider reads it: the stored quantity and cost, plus the
 * product labels the ledger movement will carry.
 */
export interface WriteOffLineDetail extends WriteOffLineRow {
  sku: string
  productName: string
}

/** A header with the branch labels and the line count, for the list and the detail. */
export interface WriteOffListRow {
  id: string
  number: string
  branchId: string
  branchCode: string
  branchName: string
  status: StockWriteOffStatus
  note: string | null
  valueMinor: number
  approvalId: string | null
  requestedBy: string
  postedAt: Date | null
  createdBy: string | null
  createdAt: Date
  updatedAt: Date
  cancelledBy: string | null
  cancelledAt: Date | null
  lineCount: number
}

/**
 * The request behind a write-off, if one was raised. A write-off is always
 * raised with one, so this is only null for a row whose approval was pruned.
 */
export interface WriteOffApproval {
  id: string
  status: ApprovalStatus
  requestedBy: string
  decidedBy: string | null
  decidedAt: Date | null
  decisionReasonCode: ApprovalReasonCode | null
}

/**
 * The whole document: the header, the lines with their frozen cost, and the
 * approval. The decider sees the evidence, not just an id (P12-D4).
 */
export interface WriteOffDetail {
  writeOff: WriteOffListRow
  lines: WriteOffLineDetail[]
  approval: WriteOffApproval | null
}

export interface WriteOffListResponse {
  writeOffs: WriteOffListRow[]
  total: number
  branchId: string | null
}

/**
 * The branch's projection of one product, read in this module's own repository:
 * `avgCostMinor` is what the request freezes into the line (P12-D17), and
 * `quantityOnHand` is what the decision guard will compare against.
 */
export interface WriteOffLevelSnapshot {
  quantityOnHand: number
  avgCostMinor: number
}
