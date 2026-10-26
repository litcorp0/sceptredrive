// --- Approvals (the unified decision inbox) ---
//
// These mirror `api/src/modules/approvals/approvals.types.ts`. The console never re-implements
// the decision rule: `canDecide` and `canWithdraw` arrive on the detail payload, computed for
// this actor by the API. `subject` is one arm per approval type, and every field the decider
// needs is on the arm — the consoles never reads `payload` for a value the subject carries.
//
// Money is integer minor units. Dates arrive as ISO strings and are formatted with
// `@sceptre/shared` at the edge of the screen.

import type { ApprovalReasonCode, ApprovalStatus, ApprovalType } from "@sceptre/shared"

export interface ApprovalRow {
	id: string
	type: ApprovalType
	entityId: string | null
	branchId: string
	status: ApprovalStatus
	requestedBy: string
	requestedAt: string
	requestNote: string | null
	deciderRole: string
	deciderBranchId: string | null
	amountMinor: number | null
	/** The proposed document for types that do not have a row yet (a product submission). */
	payload: Record<string, unknown>
	decidedBy: string | null
	decidedAt: string | null
	decisionReasonCode: ApprovalReasonCode | null
	decisionNote: string | null
	createdAt: string
	updatedAt: string
}

/**
 * What the decision is about, as the API serialises it. One arm per registered type; `other`
 * is the honest fallback for a type whose owning plan has not registered a loader yet.
 */
export type ApprovalSubject =
	| { kind: "purchase_order"; purchaseOrderId: string }
	| { kind: "product"; proposal: unknown }
	| {
			kind: "transfer"
			transferId: string
			fromBranchId: string
			toBranchId: string
			lineCount: number
	  }
	| { kind: "stock_write_off"; writeOffId: string; number: string; lineCount: number }
	| {
			kind: "price_change"
			productId: string
			branchId: string
			currentPriceMinor: number
			proposedPriceMinor: number
			productName: string
			sku: string
			bandPercent: number
			bounds: { minMinor: number; maxMinor: number }
	  }
	| {
			kind: "credit_limit_change"
			customerId: string
			branchId: string
			currentLimitMinor: number
			proposedLimitMinor: number
			balanceMinor: number
			customerName: string
			phone: string | null
			utilisationBp: number | null
			resultingPosition: {
				limitMinor: number
				balanceMinor: number
				overByMinor: number
				headroomMinor: number
				overLimit: boolean
				blocksNewCredit: boolean
			}
	  }
	| {
			kind: "shift_variance"
			shiftId: string
			terminalName: string
			expectedMinor: number
			countedMinor: number
			varianceMinor: number
			shiftNumber: string
			cashierName: string | null
			openedAt: string
			closedAt: string
			saleCount: number
			clientExpectedMinor: number
	  }
	| { kind: "other" }

/** A list row adds the subject discriminator; the subject itself is loaded only for a detail. */
export type ApprovalListRow = ApprovalRow & { subjectKind: ApprovalSubject["kind"] }

export interface ApprovalListQuery {
	type?: ApprovalType
	status?: ApprovalStatus
	entityId?: string
	branchId?: string
	sort?: "oldest" | "newest"
	limit?: number
	offset?: number
}

export interface ApprovalListResult {
	approvals: ApprovalListRow[]
	total: number
	branchId: string | null
}

/** The badge and the manager's view: one count per type, zeroes included. */
export interface ApprovalSummary {
	pending: number
	byType: Record<ApprovalType, number>
	branchId: string | null
}

export interface ApprovalDetail {
	approval: ApprovalRow
	subject: ApprovalSubject
	/** Both computed for this actor, so the console never re-implements the rule. */
	canDecide: boolean
	canWithdraw: boolean
}

export interface ApprovalDecisionInput {
	decision: "APPROVED" | "REJECTED"
	reasonCode?: ApprovalReasonCode
	note?: string
}
