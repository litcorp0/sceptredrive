import type { ApprovalReasonCode, ApprovalStatus, ApprovalType } from '@sceptre/shared'
import type { approval } from './approvals.schema.ts'

export type ApprovalRow = typeof approval.$inferSelect

/**
 * The route's query, before branch scoping. `sort` defaults to `oldest`: the
 * inbox is a queue, not a log.
 */
export interface ApprovalListQuery {
  type?: ApprovalType
  status?: ApprovalStatus
  entityId?: string
  branchId?: string | null
  sort?: 'oldest' | 'newest'
  limit: number
  offset: number
}

/**
 * A list filter after the service has resolved the caller's scope.
 *
 * `scope` is `null` for an admin (every branch). `includeDeciderBranch` is true
 * for a scoped manager: a transfer request is raised at the destination and
 * decided by the source manager, so the manager must see both sides — P12-D11.
 */
export interface ApprovalListFilters {
  type?: ApprovalType
  status?: ApprovalStatus
  entityId?: string
  sort: 'oldest' | 'newest'
  limit: number
  offset: number
  scope: { branchId: string } | null
  includeDeciderBranch: boolean
}

/**
 * A page of the inbox. Each row carries the subject's discriminator so the
 * console can draw an icon and a link without the API running one subject loader
 * per row; the subject itself is only loaded for a single detail read.
 */
export type ApprovalListRow = ApprovalRow & { subjectKind: ApprovalSubject['kind'] }

export interface ApprovalList {
  approvals: ApprovalListRow[]
  total: number
  branchId: string | null
}

/** The badge and the manager's view — one count per type, zeroes included. */
export interface ApprovalSummary {
  pending: number
  byType: Record<ApprovalType, number>
  branchId: string | null
}

export interface ApprovalDecisionBody {
  decision: 'APPROVED' | 'REJECTED'
  reasonCode?: ApprovalReasonCode
  note?: string
}

/**
 * What the decision is about, rendered by the console without a second request.
 * One arm per type that can be requested; `other` is the honest fallback for a
 * type whose owning plan has not registered a loader yet (only `REFUND`, until
 * Phase 13).
 */
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
