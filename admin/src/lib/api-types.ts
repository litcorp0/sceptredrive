/**
 * Response and input types mirroring the API contracts in `api/src/modules/*`.
 * Hand-maintained for Phase 1; a shared contracts package can replace this in
 * Phase 2 when catalog endpoints land.
 */

/**
 * The aging bucket shape, shared by credit's report (owned by `#/modules/credit`, which
 * re-exports these) and the payables aging report below. Payables still reads them from here;
 * Plan 11 decides where they finally live.
 */
export type AgingBucketKey = "current" | "days1To30" | "days31To60" | "days61To90" | "over90"

export interface AgingBuckets {
	current: number
	days1To30: number
	days31To60: number
	days61To90: number
	over90: number
}

// --- Payables (supplier invoices, payments, balances, aging) ---
//
// The supplier master (supplier rows, payment details, supplied products) moved to
// `#/modules/suppliers` in Phase 8. Payables still reads the supplier rows it joins onto its own
// documents through the ageing and balance shapes below; Plan 11 moves these too.

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
}

export type SupplierInvoiceListQuery = {
	supplierId?: string
	branchId?: string
	receiptId?: string
	status?: SupplierInvoiceStatus
	overdue?: boolean
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
