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
  | { kind: 'product'; proposal: unknown }
  | {
      kind: 'transfer'
      transferId: string
      fromBranchId: string
      toBranchId: string
      lineCount: number
    }
  | { kind: 'stock_write_off'; writeOffId: string; number: string; lineCount: number }
  | {
      kind: 'price_change'
      productId: string
      branchId: string
      currentPriceMinor: number
      proposedPriceMinor: number
    }
  | {
      kind: 'credit_limit_change'
      customerId: string
      branchId: string
      currentLimitMinor: number
      proposedLimitMinor: number
      balanceMinor: number
    }
  | {
      kind: 'shift_variance'
      shiftId: string
      terminalName: string
      expectedMinor: number
      countedMinor: number
      varianceMinor: number
    }
  | { kind: 'other' }

/**
 * Loads the subject of one approval. Registered by the owning service at module
 * load (`owner → approvals`), read-only, and never given a transaction: a detail
 * read must not open one (P12-D4).
 */
export type SubjectLoader = (approval: ApprovalRow) => Promise<ApprovalSubject>

export interface ApprovalDetail {
  approval: ApprovalRow
  subject: ApprovalSubject
  /** Computed for this actor, so the console never re-implements the rule. */
  canDecide: boolean
  canWithdraw: boolean
}
