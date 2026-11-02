// --- Procurement (purchase orders, receiving, supplier returns, approvals) ---
//
// These mirror the API contracts in `api/src/modules/procurement` and
// `api/src/modules/approvals`. The console never derives a lifecycle state: `canApply` and
// `canDecide` arrive from the server, and the types below only describe what it sends.
//
// Money is integer minor units everywhere. Dates arrive as ISO strings and are formatted with
// `@sceptre/shared` at the edge of the screen.

import type {
	ApprovalReasonCode,
	ApprovalStatus,
	PurchaseOrderAction,
	PurchaseOrderStatus,
} from "@sceptre/shared"

// ---------------------------------------------------------------- purchase orders

export type OrderStatus = PurchaseOrderStatus

export interface OrderApprovalSummary {
	id: string
	status: ApprovalStatus
	requestedBy: string
	decidedBy: string | null
	decidedAt: string | null
	decisionReasonCode: ApprovalReasonCode | null
}

/** The order row carried on the detail payload. */
export interface OrderRow {
	id: string
	number: string
	branchId: string
	supplierId: string
	status: OrderStatus
	expectedDate: string | null
	note: string | null
	requestedBy: string
	approvalId: string | null
	submittedAt: string | null
	approvedAt: string | null
	rejectedAt: string | null
	sentAt: string | null
	sentBy: string | null
	closedAt: string | null
	closedBy: string | null
	closeNote: string | null
	cancelledAt: string | null
	cancelledBy: string | null
	cancelReason: string | null
	idempotencyKey: string | null
	createdBy: string | null
	createdAt: string
	updatedAt: string
}

export interface OrderLine {
	id: string
	lineNumber: number
	productId: string
	sku: string
	name: string
	quantity: number
	unitCostMinor: number
	lineTotalMinor: number
	receivedQuantity: number
	outstandingQuantity: number
}

export interface OrderDetail {
	order: OrderRow & { supplierName: string; supplierCode: string }
	lines: OrderLine[]
	goodsValueMinor: number
	threshold: { valueMinor: number; source: "branch" | "global" | "default" }
	approval: OrderApprovalSummary | null
	/** Computed server-side from the shared transition table and the actor's permissions. */
	canApply: Record<PurchaseOrderAction, boolean>
}

export interface OrderListRow {
	id: string
	number: string
	status: OrderStatus
	supplierId: string
	supplierName: string
	branchId: string
	branchCode: string
	expectedDate: string | null
	goodsValueMinor: number
	receivedQuantity: number
	orderedQuantity: number
	createdAt: string
}

export interface OrderListResult {
	orders: OrderListRow[]
	total: number
	branchId: string | null
}

export interface OrderListQuery {
	branchId?: string
	supplierId?: string
	status?: OrderStatus
	q?: string
	limit?: number
	offset?: number
}

export interface OrderLineInput {
	productId: string
	quantity: number
	unitCostMinor: number
}

export interface OrderCreateInput {
	branchId: string
	supplierId: string
	expectedDate?: string
	note?: string
	idempotencyKey: string
	lines: OrderLineInput[]
}

export interface OrderUpdateInput {
	supplierId?: string
	expectedDate?: string | null
	note?: string | null
	lines?: OrderLineInput[]
}

export interface OrderFromSuggestionsInput {
	branchId: string
	supplierId: string
	expectedDate?: string
	note?: string
	idempotencyKey: string
	lines: { productId: string; quantity: number; unitCostMinor?: number }[]
}

export interface OrderCancelInput {
	reason: string
}

export interface OrderCloseInput {
	note?: string
}

/** A row on the invoice form's purchase-order picker. */
export interface MatchableOrder {
	id: string
	number: string
	status: OrderStatus
	expectedDate: string | null
	goodsValueMinor: number
}

// ---------------------------------------------------------------- receiving

export type OverReceiptReason = "SUPPLIER_SENT_MORE" | "ORDER_ROUNDING" | "SUBSTITUTE" | "OTHER"

export interface ReceiveLineInput {
	purchaseOrderLineId: string
	quantity: number
	unitCostMinor: number
	overReceiptReason?: OverReceiptReason
	overReceiptNote?: string
}

export interface ReceiveOrderInput {
	idempotencyKey: string
	supplierInvoiceNumber?: string
	note?: string
	lines: ReceiveLineInput[]
}

/** The receipt the receive call created. The full receipt lives in `modules/inventory`. */
export interface ReceivedReceipt {
	id: string
	number: string
	branchId: string
}

export interface ReceiveOrderResult {
	receipt: ReceivedReceipt
	order: OrderDetail
	replayed: boolean
}

// ---------------------------------------------------------------- supplier returns

export type ReturnStatus = "DRAFT" | "POSTED" | "CANCELLED"

export interface ReturnRow {
	id: string
	number: string
	branchId: string
	supplierId: string
	purchaseOrderId: string | null
	receiptId: string | null
	status: ReturnStatus
	reason: string
	note: string | null
	creditNoteNumber: string | null
	supplierCreditNoteNumber: string | null
	postedAt: string | null
	postedBy: string | null
	cancelledAt: string | null
	cancelledBy: string | null
	cancelReason: string | null
	idempotencyKey: string | null
	createdBy: string | null
	createdAt: string
	updatedAt: string
}

export interface ReturnListRow extends ReturnRow {
	supplierName: string
	creditMinor: number | null
}

export interface ReturnListResult {
	returns: ReturnListRow[]
	total: number
	branchId: string | null
}

export interface ReturnListQuery {
	branchId?: string
	supplierId?: string
	status?: ReturnStatus
	limit?: number
	offset?: number
}

export interface ReturnLine {
	id: string
	receiptLineId: string
	receiptNumber: string
	productId: string
	sku: string
	name: string
	quantity: number
	unitCostMinor: number
	lineCreditMinor: number
	receivedQuantity: number
}

export interface ReturnDetail {
	supplierReturn: ReturnRow
	supplierName: string
	lines: ReturnLine[]
	creditNote: { number: string; amountMinor: number; postedAt: string } | null
	totalCreditMinor: number
	canPost: boolean
	canCancel: boolean
}

/** What can still be sent back against one receipt line (P11-D1's cap). */
export interface ReturnableReceiptLine {
	id: string
	productId: string
	sku: string
	name: string
	receivedQuantity: number
	returnedQuantity: number
	returnableQuantity: number
	unitCostMinor: number
}

export interface ReturnableReceipt {
	receipt: {
		id: string
		number: string
		branchId: string
		purchaseOrderId: string | null
		supplierId: string | null
		supplierName: string | null
		createdAt: string
	}
	lines: ReturnableReceiptLine[]
}

export interface ReturnCreateInput {
	branchId: string
	supplierId: string
	purchaseOrderId?: string
	receiptId?: string
	reason: string
	note?: string
	supplierCreditNoteNumber?: string
	idempotencyKey: string
	lines: { receiptLineId: string; quantity: number }[]
}

// ---------------------------------------------------------------- product submissions
//
// The approval row itself now belongs to `modules/approvals`. This module owns only the manager's
// proposal body and the id of the approval it creates.
/**
 * A manager's product proposal. It is not a product: the row exists only if an admin approves the
 * `PRODUCT_CREATE` request this body creates (P11-D7).
 */
export interface ProductSubmissionInput {
	name: string
	categoryId: string
	uomId: string
	brandId?: string
	description?: string
	proposedBasePriceMinor: number
	barcode?: string
	supplierId?: string
	note?: string
	openingQuantity?: number
	openingUnitCostMinor?: number
}

export interface ProductSubmissionResult {
	approvalId: string
	status: "PENDING"
}
