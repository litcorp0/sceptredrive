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
 * type whose owning plan has not registered a loader yet.
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
      /** The product the prices belong to, so the console needs no second read. */
      productName: string
      sku: string
      /** The band the request was judged against, from its stored payload. */
      bandPercent: number
      /** Inclusive window `bandPercent` allows around `currentPriceMinor`. */
      bounds: { minMinor: number; maxMinor: number }
    }
  | {
      kind: 'credit_limit_change'
      customerId: string
      branchId: string
      currentLimitMinor: number
      proposedLimitMinor: number
      balanceMinor: number
      /** The customer identity the decider is deciding about. */
      customerName: string
      phone: string | null
      /** `ratioBp(balance, proposedLimit)`; null only if the proposal is zero. */
      utilisationBp: number | null
      /** Where the customer stands if the proposal is approved (P12-D21). */
      resultingPosition: {
        limitMinor: number
        balanceMinor: number
        /** Zero when there is headroom; the positive excess otherwise. */
        overByMinor: number
        /** `limit - balance` when positive, zero when the customer is over. */
        headroomMinor: number
        overLimit: boolean
        /** True when the next positive charge would exceed the limit. */
        blocksNewCredit: boolean
      }
    }
  | {
      kind: 'shift_variance'
      shiftId: string
      terminalName: string
      expectedMinor: number
      countedMinor: number
      varianceMinor: number
      /** Close-time facts the reviewer needs; the payload is the fallback. */
      shiftNumber: string
      cashierName: string | null
      openedAt: string
      closedAt: string
      saleCount: number
      clientExpectedMinor: number
    }
  | {
      kind: 'refund'
      refundId: string
      number: string
      saleId: string
      /** The receipt the customer brought back. */
      receiptNumber: string
      refundedMinor: number
      reasonCode: string
      lineCount: number
      itemCount: number
      /** Restock decisions counted in lines, one decision per line (P13-D22). */
      restock: { resalable: number; damaged: number; notReturned: number }
      /**
       * The per-line evidence behind those counts, in `refund_line.line_number`
       * order. `productName` and `sku` are the sale line's snapshot, because the
       * receipt the customer holds shows what was sold, not today's catalogue.
       */
      lines: Array<{
        productName: string
        sku: string
        quantity: number
        restock: 'RESALABLE' | 'DAMAGED' | 'NOT_RETURNED'
        damageReason: string | null
        totalMinor: number
      }>
      tenders: Array<{ method: string; amountMinor: number; status: string }>
      /** The manager whose PIN authorised the return, by staff id. */
      approvedBy: string
      occurredAt: string
      /** What the sale was worth before it was refunded. */
      originalTotalMinor: number
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
