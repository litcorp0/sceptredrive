import type { ApprovalReasonCode, ApprovalStatus } from "@sceptre/shared"

export type AdjustmentReason = "DAMAGE" | "LOSS" | "FOUND" | "CORRECTION" | "EXPIRED" | "OTHER"

/**
 * Mirrors `stock_movement_type` in the API. `SALE` arrived with the POS in Phase 6;
 * `SUPPLIER_RETURN` with Phase 11 and `WRITE_OFF` with Phase 12. Keep this in step with the
 * enum: `MOVEMENT_META` is a `Record` over this union, so a missing arm is a type error rather
 * than a `TypeError` in the stock history table.
 */
export type StockMovementType =
	| "RECEIPT"
	| "ADJUSTMENT"
	| "TRANSFER_OUT"
	| "TRANSFER_IN"
	| "COUNT_VARIANCE"
	| "SALE"
	| "SUPPLIER_RETURN"
	| "WRITE_OFF"

export interface StockRow {
	productId: string
	sku: string
	productName: string
	categoryName: string
	quantityOnHand: number
	avgCostMinor: number
	valueMinor: number
	threshold: number | null
	isLow: boolean
	updatedAt: string
}

export interface StockDetail {
	productId: string
	sku: string
	productName: string
	categoryName: string
	taxCategory: string
	basePriceMinor: number
	costPriceMinor: number
	isActive: boolean
	quantityOnHand: number
	avgCostMinor: number
	valueMinor: number
	threshold: number | null
	updatedAt: string | null
}

export type StockListQuery = {
	branchId?: string
	q?: string
	lowStock?: boolean
	limit?: number
	offset?: number
}

export interface MovementRow {
	id: string
	productId: string
	branchId: string
	type: StockMovementType
	quantityDelta: number
	unitCostMinor: number
	referenceType: string
	referenceId: string | null
	referenceNumber: string | null
	reasonCode: AdjustmentReason | null
	note: string | null
	createdBy: string | null
	createdAt: string
	sku: string
	productName: string
	branchCode: string
}

export type MovementListQuery = {
	branchId?: string
	productId?: string
	type?: StockMovementType
	from?: string
	to?: string
	limit?: number
	offset?: number
}

export interface InventoryReceiptLine {
	id: string
	productId: string
	sku: string
	productName: string
	quantity: number
	unitCostMinor: number
	movementId: string
}

export interface InventoryReceipt {
	id: string
	number: string
	branchId: string
	branchCode: string
	branchName: string
	purchaseOrderId: string | null
	supplierName: string | null
	supplierId: string | null
	supplierInvoiceNumber: string | null
	note: string | null
	createdBy: string | null
	createdAt: string
	lineCount: number
	totalCostMinor: number
	lines?: InventoryReceiptLine[]
}

export interface ReceiptCreateInput {
	branchId: string
	supplierId?: string
	supplierName?: string
	supplierInvoiceNumber?: string
	note?: string
	lines: { productId: string; quantity: number; unitCostMinor: number }[]
}

export type ReceiptListQuery = {
	branchId?: string
	/** The purchase order a delivery fulfils (Phase 11). */
	purchaseOrderId?: string
	from?: string
	to?: string
	limit?: number
	offset?: number
}

export interface AdjustmentCreateInput {
	branchId: string
	productId: string
	quantityDelta: number
	reasonCode: AdjustmentReason
	note?: string
}

export interface StockThreshold {
	id: string
	productId: string
	sku: string
	productName: string
	branchId: string
	threshold: number
	/** Top-up level; `null` when the branch has not set one. */
	maxQuantity: number | null
	/** A supplier's minimum order quantity: a floor on the suggestion. */
	minOrderQuantity: number
	updatedBy: string | null
	updatedAt: string
}

export interface ThresholdInput {
	branchId: string
	productId: string
	threshold: number
	/** Omitted keeps the stored maximum; `null` removes it. */
	maxQuantity?: number | null
	minOrderQuantity?: number
}

export type TransferStatus =
	| "DRAFT"
	| "REQUESTED"
	| "APPROVED"
	| "REJECTED"
	| "DISPATCHED"
	| "RECEIVED"
	| "SHORT_CLOSED"
	| "CANCELLED"

export interface TransferLine {
	id: string
	transferId: string
	productId: string
	quantityRequested: number
	quantityDispatched: number
	quantityReceived: number
	unitCostMinor: number
	sku: string
	productName: string
	pending: number
	fromOnHand: number
	toOnHand: number
}

/**
 * The request behind a transfer, if one was raised. An admin-created `DRAFT` has none; a
 * manager's request always does. Mirrors `TransferApproval` in the API.
 */
export interface TransferApproval {
	id: string
	status: ApprovalStatus
	requestedBy: string
	decidedBy: string | null
	decidedAt: string | null
	decisionReasonCode: ApprovalReasonCode | null
}

export interface Transfer {
	id: string
	number: string
	fromBranchId: string
	fromBranchCode: string
	fromBranchName: string
	toBranchId: string
	toBranchCode: string
	toBranchName: string
	status: TransferStatus
	/** The decision on a manager's request; absent on list rows, `null` for an admin's draft. */
	approval?: TransferApproval | null
	/** Server-computed dispatch rule; present on the detail, so the console never re-implements it. */
	canDispatch?: boolean
	note: string | null
	createdBy: string | null
	dispatchedBy: string | null
	dispatchedAt: string | null
	receivedBy: string | null
	receivedAt: string | null
	closedBy: string | null
	closedAt: string | null
	cancelledBy: string | null
	cancelledAt: string | null
	createdAt: string
	updatedAt: string
	lineCount: number
	unitsDispatched: number
	unitsReceived: number
	lines?: TransferLine[]
}

export interface TransferCreateInput {
	fromBranchId: string
	toBranchId: string
	note?: string
	lines: { productId: string; quantityRequested: number }[]
}

export type TransferListQuery = {
	branchId?: string
	status?: TransferStatus
	direction?: "from" | "to"
	limit?: number
	offset?: number
}

export type StockCountStatus = "OPEN" | "POSTED" | "CANCELLED"

export interface StockCountLine {
	id: string
	countId: string
	productId: string
	snapshotQty: number
	countedQty: number | null
	sku: string
	productName: string
	variance: number | null
}

export interface StockCount {
	id: string
	number: string
	branchId: string
	branchCode: string
	branchName: string
	categoryId: string | null
	status: StockCountStatus
	note: string | null
	createdBy: string | null
	postedBy: string | null
	postedAt: string | null
	cancelledBy: string | null
	cancelledAt: string | null
	createdAt: string
	updatedAt: string
	lineCount: number
	countedCount: number
	varianceUnits: number
	lines?: StockCountLine[]
}

export interface CountCreateInput {
	branchId: string
	categoryId?: string
	note?: string
}

export type CountListQuery = {
	branchId?: string
	status?: StockCountStatus
	limit?: number
	offset?: number
}

// ---------------------------------------------------------------- stock write-offs (Phase 12)
//
// Mirrors `api/src/modules/writeoffs/writeoffs.types.ts`. A write-off is a document, not an
// adjustment: it is raised complete, decided as one unit, and `APPROVED` means posted. The value
// is frozen at request time; the console formats it and never recomputes a line total.

export type WriteOffStatus = "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "CANCELLED"

export type WriteOffReason =
	| "DAMAGE"
	| "EXPIRY"
	| "OBSOLESCENCE"
	| "THEFT"
	| "SUPPLIER_FAULT"
	| "OTHER"

export interface WriteOffListRow {
	id: string
	number: string
	branchId: string
	branchCode: string
	branchName: string
	status: WriteOffStatus
	note: string | null
	valueMinor: number
	approvalId: string | null
	requestedBy: string
	postedAt: string | null
	createdBy: string | null
	createdAt: string
	updatedAt: string
	cancelledBy: string | null
	cancelledAt: string | null
	lineCount: number
}

export interface WriteOffListResult {
	writeOffs: WriteOffListRow[]
	total: number
	branchId: string | null
}

export interface WriteOffListQuery {
	branchId?: string
	status?: WriteOffStatus
	limit?: number
	offset?: number
}

/** One line of a write-off request. The branch and the cost are decided server-side. */
export interface WriteOffLineInput {
	productId: string
	quantity: number
	reason: WriteOffReason
	/** Required by the server for `THEFT` and `OTHER`. */
	note?: string
}

export interface WriteOffCreateInput {
	lines: WriteOffLineInput[]
	note?: string
}

export interface WriteOffLineDetail {
	id: string
	writeOffId: string
	productId: string
	quantity: number
	unitCostMinor: number
	reason: WriteOffReason
	note: string | null
	sku: string
	productName: string
}

export interface WriteOffApproval {
	id: string
	status: ApprovalStatus
	requestedBy: string
	decidedBy: string | null
	decidedAt: string | null
	decisionReasonCode: ApprovalReasonCode | null
}

export interface WriteOffDetail {
	writeOff: WriteOffListRow
	lines: WriteOffLineDetail[]
	approval: WriteOffApproval | null
}
