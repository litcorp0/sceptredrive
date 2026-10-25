import type { ApprovalReasonCode, ApprovalStatus, ApprovalType } from '@sceptre/shared'
import type { approval } from './approvals.schema.ts'

export type ApprovalRow = typeof approval.$inferSelect

export interface ApprovalListQuery {
  type?: ApprovalType
  status?: ApprovalStatus
  /** Already resolved for the caller: a manager's own branch, or an admin's filter. */
  branchId: string | null
  limit: number
  offset: number
}

export interface ApprovalList {
  approvals: ApprovalRow[]
  total: number
  branchId: string | null
}

export interface ApprovalDecisionBody {
  decision: 'APPROVED' | 'REJECTED'
  reasonCode?: ApprovalReasonCode
  note?: string
}

/** What the decision is about, rendered by the console without a second request. */
export type ApprovalSubject =
  | { kind: 'purchase_order'; purchaseOrderId: string }
  | { kind: 'product'; proposal: Record<string, unknown> }
  | { kind: 'other' }

export interface ApprovalDetail {
  approval: ApprovalRow
  subject: ApprovalSubject
  /** Computed for this actor, so the console never re-implements the rule. */
  canDecide: boolean
  canWithdraw: boolean
}
