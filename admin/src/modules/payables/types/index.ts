// --- Payables (supplier invoices, payments, balances, aging) ---
//
// These mirror the API contracts in `api/src/modules/payables`. They moved here from
// `lib/api-types.ts` in Phase 8; the barrel is `#/modules/payables`.
//
// The aging bucket shape is the one piece of vocabulary credit shares: its receivables report
// uses the same five buckets, and `#/modules/credit` re-exports it from here rather than
// declaring a second copy that could drift.

export type AgingBucketKey = "current" | "days1To30" | "days31To60" | "days61To90" | "over90"

export interface AgingBuckets {
	current: number
	days1To30: number
	days31To60: number
	days61To90: number
	over90: number
}

export type SupplierInvoiceStatus = "OPEN" | "PARTIAL" | "PAID" | "VOID"
export type SupplierInvoiceVoidReason = "DUPLICATE" | "CANCELLED" | "ERROR" | "OTHER"
export type SupplierPaymentMethod = "CASH" | "BANK" | "MOMO"
export type SupplierPaymentStatus = "COMPLETED" | "VOID"
export type SupplierPaymentVoidReason =
	| "DUPLICATE"
	| "ERROR"
	| "RETURNED"
	| "BANK_REVERSAL"
	| "OTHER"
export type AllocationKind = "APPLY" | "RELEASE"

export interface SupplierInvoiceLine {
	id: string
	productId: string | null
	sku: string | null
	productName: string | null
	description: string | null
	quantity: number
	unitCostMinor: number
	lineTotalMinor: number
}

/** The API's `invoice_match_status`; a variance is advisory, never a block (P11-D5). */
export type InvoiceMatchStatus =
	| "UNMATCHED"
	| "MATCHED"
	| "PRICE_VARIANCE"
	| "QUANTITY_VARIANCE"
	| "PRICE_AND_QUANTITY_VARIANCE"
	| "NOT_ON_ORDER"

/** Invoice row on list responses (supplier and branch names joined in). */
export interface SupplierInvoice {
	id: string
	number: string
	supplierId: string
	supplierCode: string
	supplierName: string
	branchId: string
	branchCode: string
	branchName: string
	supplierInvoiceNumber: string
	invoiceDate: string
	dueDate: string
	receiptId: string | null
	purchaseOrderId: string | null
	purchaseOrderNumber: string | null
	/** True when any line carries a purchase-order variance. */
	hasVariance: boolean
	subtotalMinor: number
	vatMinor: number
	nhilMinor: number
	getfundMinor: number
	totalMinor: number
	amountPaidMinor: number
	outstandingMinor: number
	status: SupplierInvoiceStatus
	createdAt: string
}

/** Raw invoice row carried on the detail payload. */
export interface SupplierInvoiceRow {
	id: string
	number: string
	supplierId: string
	branchId: string
	supplierInvoiceNumber: string
	invoiceDate: string
	dueDate: string
	receiptId: string | null
	subtotalMinor: number
	vatMinor: number
	nhilMinor: number
	getfundMinor: number
	totalMinor: number
	amountPaidMinor: number
	status: SupplierInvoiceStatus
	voidReason: SupplierInvoiceVoidReason | null
	voidedBy: string | null
	voidedAt: string | null
	note: string | null
	idempotencyKey: string | null
	createdBy: string | null
	createdAt: string
	updatedAt: string
}

export interface SupplierInvoiceAllocation {
	id: string
	paymentId: string
	paymentNumber: string
	method: SupplierPaymentMethod
	paymentStatus: SupplierPaymentStatus
	paidAt: string
	kind: AllocationKind
	amountMinor: number
	reversesAllocationId: string | null
	note: string | null
	createdAt: string
}

export interface SupplierInvoiceDetail {
	invoice: SupplierInvoiceRow & { outstandingMinor: number }
	supplier: { id: string; code: string; name: string }
	receipt: { id: string; number: string; branchId: string } | null
	lines: SupplierInvoiceLine[]
	allocations: SupplierInvoiceAllocation[]
	/** Null when the invoice was not recorded against a purchase order. */
	match: InvoiceMatch | null
}

export interface InvoiceMatchLine {
	lineNumber: number
	productId: string | null
	sku: string
	name: string
	invoicedQuantity: number
	invoicedUnitCostMinor: number
	orderedQuantity: number | null
	orderedUnitCostMinor: number | null
	receivedQuantity: number
	previouslyInvoicedQuantity: number
	matchStatus: InvoiceMatchStatus
}

export interface InvoiceMatch {
	purchaseOrderId: string
	orderNumber: string
	/** The worst status across the lines: what the invoice's badge should say. */
	status: InvoiceMatchStatus
	lines: InvoiceMatchLine[]
}

export type SupplierInvoiceListQuery = {
	supplierId?: string
	branchId?: string
	receiptId?: string
	status?: SupplierInvoiceStatus
	overdue?: boolean
	/** Only invoices with at least one purchase-order variance (PROC-04). */
	variance?: boolean
	from?: string
	to?: string
	limit?: number
	offset?: number
}

export interface SupplierInvoiceListResult {
	invoices: SupplierInvoice[]
	total: number
	branchId: string | null
}

export interface InvoiceLineInput {
	productId?: string
	description?: string
	quantity: number
	unitCostMinor: number
}

/**
 * Line unit costs are tax-inclusive for the derived standard split. Omit the
 * tax fields to derive 20% (VAT 15 + NHIL 2.5 + GETFund 2.5); send zeroes for
 * no tax, or all three for a manual split. The server recomputes totals.
 */
export interface InvoiceCreateInput {
	supplierId: string
	branchId?: string
	supplierInvoiceNumber: string
	invoiceDate: string
	dueDate?: string
	receiptId?: string
	/** The purchase order this invoice settles (PROC-04); the API matches by product. */
	purchaseOrderId?: string
	copyFromReceipt?: boolean
	lines?: InvoiceLineInput[]
	vatMinor?: number
	nhilMinor?: number
	getfundMinor?: number
	note?: string
	idempotencyKey?: string
}

export interface InvoiceVoidInput {
	reason: SupplierInvoiceVoidReason
}

/** Raw payment row as returned on the detail payload. */
export interface SupplierPaymentRow {
	id: string
	number: string
	supplierId: string
	branchId: string
	method: SupplierPaymentMethod
	amountMinor: number
	paidAt: string
	reference: string | null
	note: string | null
	paymentDetailId: string | null
	status: SupplierPaymentStatus
	voidReason: SupplierPaymentVoidReason | null
	voidedBy: string | null
	voidedAt: string | null
	idempotencyKey: string | null
	createdBy: string | null
	createdAt: string
	updatedAt: string
}

/** Payment row on list responses, enriched with its allocation totals. */
export interface SupplierPayment extends SupplierPaymentRow {
	supplierCode: string
	supplierName: string
	branchCode: string
	branchName: string
	allocatedMinor: number
	unallocatedMinor: number
}

export interface SupplierPaymentAllocation {
	id: string
	invoiceId: string
	invoiceNumber: string
	supplierInvoiceNumber: string
	invoiceBranchId: string
	kind: AllocationKind
	amountMinor: number
	reversesAllocationId: string | null
	createdAt: string
}

export interface SupplierPaymentDetail {
	payment: SupplierPaymentRow
	supplier: { id: string; code: string; name: string }
	allocations: SupplierPaymentAllocation[]
	allocatedMinor: number
	unallocatedMinor: number
}

export interface PaymentAllocationInput {
	invoiceId: string
	amountMinor: number
}

export interface PaymentCreateInput {
	supplierId: string
	branchId?: string
	method: SupplierPaymentMethod
	amountMinor: number
	paidAt: string
	reference?: string
	note?: string
	paymentDetailId?: string
	allocations?: PaymentAllocationInput[]
	idempotencyKey?: string
}

export interface PaymentVoidInput {
	reason: SupplierPaymentVoidReason
}

export type PaymentListQuery = {
	supplierId?: string
	branchId?: string
	method?: SupplierPaymentMethod
	status?: SupplierPaymentStatus
	from?: string
	to?: string
	limit?: number
	offset?: number
}

export interface PaymentListResult {
	payments: SupplierPayment[]
	total: number
	branchId: string | null
}

export interface SupplierBalance {
	supplierId: string
	supplierCode: string
	supplierName: string
	branchId: string | null
	invoiceOutstandingMinor: number
	onAccountMinor: number
	owedMinor: number
	overdueMinor: number
	invoiceCount: number
}

export interface SupplierBalanceResult {
	balances: SupplierBalance[]
	branchId: string | null
}

export type PayablesAgingQuery = {
	asOf?: string
	branchId?: string
	supplierId?: string
}

export interface PayableAgingInvoice {
	invoiceId: string
	number: string
	supplierInvoiceNumber: string
	dueDate: string
	outstandingMinor: number
	daysPastDue: number
	bucket: AgingBucketKey
}

export interface PayableAgingSupplier {
	supplierId: string
	supplierCode: string
	supplierName: string
	buckets: AgingBuckets
	totalOutstandingMinor: number
	onAccountMinor: number
	invoices: PayableAgingInvoice[]
}

export interface PayablesAgingResult {
	asOf: string
	branchId: string | null
	suppliers: PayableAgingSupplier[]
	totals: AgingBuckets
	totalOutstandingMinor: number
	totalOnAccountMinor: number
}
