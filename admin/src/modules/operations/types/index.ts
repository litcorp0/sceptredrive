// --- Operations (the manager's branch view) ---
//
// Mirrors `api/src/modules/operations/operations.types.ts`. A section is present only when the
// caller holds the permission behind it: an absent section means "you may not know", while a zero
// count means "nothing is waiting". The console must never turn the first into the second.

import type { ApprovalType } from "@sceptre/shared"

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

/** The approvals queue adds the per-type breakdown the nav badge already uses. */
export interface OperationsApprovalQueue extends OperationsQueue {
	/** Every `ApprovalType` is present, zero included. */
	byType: Record<ApprovalType, number>
}

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
