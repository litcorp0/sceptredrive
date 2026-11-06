import type { ApprovalReasonCode, ApprovalStatus } from "@sceptre/shared"

export type AdjustmentReason = "DAMAGE" | "LOSS" | "FOUND" | "CORRECTION" | "EXPIRED" | "OTHER"

/**
 * Mirrors `stock_movement_type` in the API. `SALE` arrived with the POS in Phase 6;
 * `SUPPLIER_RETURN` with Phase 11, `WRITE_OFF` with Phase 12 and `RETURN` with Phase 13 (a
 * resalable refund line). Keep this in step with the enum: `MOVEMENT_META` is a `Record` over
 * this union, so a missing arm is a type error rather than a `TypeError` in the history table.
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
	| "RETURN"
	| "OPENING"

export interface StockRow {
	productId: string
	sku: string
	productName: string
	categoryName: string
	/** The branch this level belongs to; the API returns it on every row. */
	branchId: string
	branchCode: string
	branchName: string
	quantityOnHand: number
	avgCostMinor: number
	valueMinor: number
	/** Effective threshold: the product's row, the branch default, or 5 (18-02). */
	threshold: number
	isLow: boolean
	/** Never held at this branch, as opposed to holding none (18-01). */
	neverStocked: boolean
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

/** One product the source branch can give, with what it holds (P20-D18). */
export interface SourceStockProduct {
	productId: string
	sku: string
	name: string
	quantityOnHand: number
}

export type StockListQuery = {
	branchId?: string
	q?: string
	lowStock?: boolean
	/** Only products with a stock level at this branch (P20-D17). */
	carried?: boolean
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

/**
 * The stock report (RPT-04). `branchId` is absent for an admin's all-branch read: the API
 * resolves a manager to their own branch and refuses a foreign id.
 *
 * `from`/`to` are ISO days and filter the *movement* section only; on-hand and value are the
 * projection as read, which is why the response carries `asOf` (P14-D16).
 */
export type StockReportQuery = {
	branchId?: string
	categoryId?: string
	lowStock?: boolean
	from?: string
	to?: string
}

export interface StockReportRow {
	productId: string
	sku: string
	productName: string
	categoryName: string
	branchId: string
	branchCode: string
	branchName: string
	quantityOnHand: number
	avgCostMinor: number
	valueMinor: number
	threshold: number | null
	belowThreshold: boolean
}

export interface StockReportBranchRow {
	branchCode: string
	branchName: string
	quantityOnHand: number
	valueMinor: number
}

/** The API's stock report. Nothing on this screen is summed in the browser. */
export interface StockReport {
	asOf: string
	period: { from: string; to: string }
	branchId: string | null
	rows: StockReportRow[]
	/** Matching rows before the API's 5 000-row cap. */
	total: number
	truncated: boolean
	totals: { quantityOnHand: number; valueMinor: number; products: number }
	/** Populated for an admin only. */
	byBranch: StockReportBranchRow[]
	movements: {
		inflow: number
		outflow: number
		byType: Array<{ type: StockMovementType; quantity: number }>
	}
	transfers: { dispatched: number; received: number; shortClosed: number }
	counts: {
		completed: number
		countedLines: number
		matchedLines: number
		varianceValueMinor: number
	}
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
	/** Opening stock: what the units cost. Only a positive FOUND/CORRECTION. */
	unitCostMinor?: number
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

// --- Phase 19: go-live opening stock -----------------------------------------

export type OpeningStatus = "DRAFT" | "POSTED"
export type OpeningLineStatus = "NEW" | "EXISTING"

/** One row exactly as the file has it; money and quantity stay strings until the API parses them. */
export interface OpeningLineInput {
	lineNo?: number
	sku?: string
	barcode?: string
	name: string
	category: string
	unit: string
	brand?: string
	price: string
	cost: string
	quantity: string
	taxCategory?: "STANDARD" | "ZERO_RATED" | "EXEMPT"
}

export interface OpeningPreviewRow {
	lineNo: number
	status: OpeningLineStatus
	productId: string | null
	sku: string | null
	name: string
	category: string
	categoryId: string | null
	/** Category path this line will create on save (P20-D21). */
	createsCategory: string[] | null
	unit: string
	uomId: string | null
	brand: string | null
	brandId: string | null
	barcode: string | null
	priceMinor: number | null
	taxCategory: "STANDARD" | "ZERO_RATED" | "EXEMPT"
	costMinor: number
	quantity: number
	onHand: number
	delta: number
	countedValueMinor: number
	deltaValueMinor: number
	warnings: string[]
	errors: string[]
}

export interface OpeningPreview {
	branchId: string
	rows: OpeningPreviewRow[]
	lineCount: number
	totalUnits: number
	countedValueMinor: number
	deltaValueMinor: number
	newProductCount: number
	uncostedLineCount: number
	/** Deduped category paths the save would create (P20-D21). */
	categoriesToCreate: string[][]
	canPost: boolean
}

export interface OpeningListRow {
	id: string
	number: string
	branchId: string
	branchCode: string
	branchName: string
	status: OpeningStatus
	countedAt: string
	note: string | null
	lineCount: number
	newProductCount: number
	totalUnits: number
	countedValueMinor: number
	postedValueMinor: number
	uncostedLineCount: number
	createdBy: string | null
	createdAt: string
	updatedAt: string
	postedBy: string | null
	postedAt: string | null
}

export interface OpeningLineDetail {
	id: string
	lineNo: number
	productId: string | null
	productSku: string | null
	productName: string | null
	isNew: boolean
	name: string
	categoryId: string | null
	unit: string | null
	uomId: string | null
	brandId: string | null
	barcode: string | null
	basePriceMinor: number | null
	taxCategory: "STANDARD" | "ZERO_RATED" | "EXEMPT" | null
	quantity: number
	unitCostMinor: number
	onHandAtDraft: number
	deltaAtDraft: number
	warning: string | null
	movementId: string | null
}

export interface OpeningDetail {
	opening: OpeningListRow
	lines: OpeningLineDetail[]
}

export interface OpeningListResult {
	openings: OpeningListRow[]
	total: number
	branchId: string | null
}

export interface OpeningListQuery {
	branchId?: string
	status?: OpeningStatus
	limit?: number
	offset?: number
}
