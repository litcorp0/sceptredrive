import type { ApprovalType } from '@sceptre/shared'

/**
 * One queue's answer: how much is waiting, and — for the approvals queue, the
 * only one whose age a manager acts on — the oldest row.
 *
 * Every queue is a count, never a page. The console opens the list it links to
 * when the manager wants rows, so the summary stays six indexed counts
 * (P12-D36, P12-D37).
 */
export interface OperationsQueue {
  count: number
  /** The oldest waiting row, or null when the queue is empty. Approvals only. */
  oldest?: {
    id: string
    type: ApprovalType
    requestedAt: string
    amountMinor: number | null
  } | null
}

/** The approvals queue adds the per-type breakdown the nav badge already shows. */
export interface OperationsApprovalQueue extends OperationsQueue {
  /** Every `ApprovalType` is present, zero included: `0` means "none waiting". */
  byType: Record<ApprovalType, number>
}

/**
 * What needs the caller today, in one response.
 *
 * **A section is present only when the caller holds the underlying permission.**
 * Absence and zero are different statements: `lowStock: { count: 0 }` says
 * "nothing is low", while a missing `lowStock` says "you are not allowed to
 * know". Serialising a forbidden section as zero would quietly tell a manager
 * their branch is fine (OWASP A01).
 *
 * The permissions are: `approval.read` for `approvals` and `shiftVariances`,
 * `inventory.read` for `transferRequests`, `writeOffs`, `lowStock` and
 * `countAccuracyBp`, and `credit.read` for `overLimitCredit`.
 */
export interface OperationsSummary {
  /** The branch every section is scoped to; `null` means every branch (an admin). */
  branchId: string | null
  approvals?: OperationsApprovalQueue
  transferRequests?: OperationsQueue
  writeOffs?: OperationsQueue
  shiftVariances?: OperationsQueue
  lowStock?: OperationsQueue
  overLimitCredit?: OperationsQueue
  /** Basis points of count lines that matched, on posted counts this month. */
  countAccuracyBp?: number | null
}
