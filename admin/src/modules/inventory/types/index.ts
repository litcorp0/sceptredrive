export type AdjustmentReason = "DAMAGE" | "LOSS" | "FOUND" | "CORRECTION" | "EXPIRED" | "OTHER"

/**
 * Mirrors `stock_movement_type` in the API. `SALE` arrived with the POS in Phase 6; the
 * client type was never widened, so a stock detail page with a sale in its history threw on
 * a missing label. Phase 9's demo month made that certain to happen.
 */
export type StockMovementType =
	| "RECEIPT"
	| "ADJUSTMENT"
	| "TRANSFER_OUT"
	| "TRANSFER_IN"
	| "COUNT_VARIANCE"
	| "SALE"

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

export type TransferStatus = "DRAFT" | "DISPATCHED" | "RECEIVED" | "SHORT_CLOSED" | "CANCELLED"

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
