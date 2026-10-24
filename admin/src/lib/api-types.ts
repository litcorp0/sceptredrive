/**
 * Response and input types mirroring the API contracts in `api/src/modules/*`.
 * Hand-maintained for Phase 1; a shared contracts package can replace this in
 * Phase 2 when catalog endpoints land.
 */

// TODO(phase-8/09): credit declares these in `#/modules/credit/types` now. This block survives
// only because `lib/api.ts` still exposes `api.credit` for the customer profile route; delete both
// together when Plan 09 migrates that page. `AgingBucketKey`/`AgingBuckets` below are the exception
// — payables shares them until Plan 11.
export type CreditEntryKind = "CHARGE" | "REPAYMENT" | "REFUND" | "ADJUSTMENT"
export type CreditMethod = "CASH" | "MOMO" | "BANK"
export type CreditReasonCode =
	| "SALE"
	| "OPENING_BALANCE"
	| "CORRECTION"
	| "WRITE_OFF"
	| "DISPUTE"
	| "RETURN"
	| "OTHER"

export interface CreditProfile {
	id: string
	customerId: string
	branchId: string
	limitMinor: number
	hold: boolean
	paymentTermDays: number
	notes: string | null
	balanceMinor: number
	createdAt: string
	updatedAt: string
}

export interface CreditProfileListRow extends CreditProfile {
	customerName: string
	customerPhone: string | null
	branchCode: string
	branchName: string
}

export interface CreditProfileUpdateInput {
	branchId?: string
	limitMinor?: number
	hold?: boolean
	paymentTermDays?: number
	notes?: string | null
}

export type CreditOverrideReason =
	| "TEMPORARY_APPROVAL"
	| "TRUSTED_CUSTOMER"
	| "URGENT_NEED"
	| "OTHER"

export interface RepaymentCreateInput {
	customerId: string
	branchId?: string
	/** Positive minor units; the server stores the negative ledger sign. */
	amountMinor: number
	method: CreditMethod
	note?: string
	idempotencyKey?: string
}

export interface CreditEntryCreateInput {
	customerId: string
	branchId?: string
	kind: "CHARGE" | "REFUND" | "ADJUSTMENT"
	/** CHARGE/REFUND positive; ADJUSTMENT signed non-zero. */
	amountMinor: number
	reasonCode?: CreditReasonCode
	referenceNumber?: string
	note?: string
	idempotencyKey?: string
	override?: { reasonCode: CreditOverrideReason; note?: string }
}

export interface CreditPostingResult {
	entry: CreditEntry
	profile: CreditProfile
}

export type AgingBucketKey = "current" | "days1To30" | "days31To60" | "days61To90" | "over90"

export interface AgingBuckets {
	current: number
	days1To30: number
	days31To60: number
	days61To90: number
	over90: number
}

export interface AgingChargeRow {
	entryId: string
	occurredAt: string
	dueDate: string
	amountMinor: number
	outstandingMinor: number
	daysPastDue: number
	bucket: AgingBucketKey
}

export interface AgingCustomerRow {
	customerId: string
	customerName: string
	branchId: string
	buckets: AgingBuckets
	totalMinor: number
	oldestDueDate: string | null
}

export interface BranchAging {
	branch: { id: string; code: string; name: string }
	customers: AgingCustomerRow[]
	totals: AgingBuckets & { total: number }
}

export interface AgingResult {
	asOf: string
	branches: BranchAging[]
}

export type AgingQuery = {
	branchId?: string
	asOf?: string
}

export interface StatementEntry {
	id: string
	kind: CreditEntryKind
	occurredAt: string
	dueDate: string | null
	amountMinor: number
	referenceType: string | null
	referenceNumber: string | null
	reasonCode: CreditReasonCode | null
	method: CreditMethod | null
	note: string | null
	createdBy: string | null
}

export interface CreditStatement {
	customer: { id: string; name: string; phone: string | null }
	branch: { id: string; code: string; name: string }
	from: string | null
	to: string
	openingBalanceMinor: number
	entries: StatementEntry[]
	closingBalanceMinor: number
	currentBalanceMinor: number
	aging: AgingChargeRow[]
}

export type StatementQuery = {
	branchId?: string
	from?: string
	to?: string
}

export interface CreditEntry {
	id: string
	customerId: string
	branchId: string
	kind: CreditEntryKind
	amountMinor: number
	reasonCode: CreditReasonCode | null
	method: CreditMethod | null
	note: string | null
	dueDate: string | null
	referenceType: string | null
	referenceId: string | null
	referenceNumber: string | null
	overrideReason: string | null
	overriddenBy: string | null
	receivedBy: string | null
	idempotencyKey: string | null
	createdBy: string | null
	occurredAt: string
	createdAt: string
	branchCode: string
}

export type CreditEntryListQuery = {
	customerId: string
	branchId?: string
	kind?: CreditEntryKind
	from?: string
	to?: string
	page?: number
	pageSize?: number
}

export interface CreditEntryListResult {
	entries: CreditEntry[]
	total: number
	page: number
	pageSize: number
}

// --- Suppliers & payables (Phase 5) ---

export type SupplierStatus = "ACTIVE" | "ARCHIVED"

/** Full supplier row as returned by the detail and mutation endpoints. */
export interface Supplier {
	id: string
	code: string
	name: string
	contactName: string | null
	phone: string | null
	email: string | null
	address: string | null
	tin: string | null
	vatNumber: string | null
	paymentTermDays: number
	notes: string | null
	status: SupplierStatus
	createdBy: string | null
	createdAt: string
	updatedAt: string
}

export interface SupplierListRow {
	id: string
	code: string
	name: string
	contactName: string | null
	phone: string | null
	email: string | null
	paymentTermDays: number
	status: SupplierStatus
	createdAt: string
	updatedAt: string
}

export type SupplierListQuery = {
	q?: string
	page?: number
	pageSize?: number
	includeArchived?: boolean
}

export interface SupplierListResult {
	suppliers: SupplierListRow[]
	total: number
	page: number
	pageSize: number
}

export interface SupplierCreateInput {
	name: string
	contactName?: string
	phone?: string
	email?: string
	address?: string
	tin?: string
	vatNumber?: string
	paymentTermDays?: number
	notes?: string
}

export interface SupplierUpdateInput {
	name?: string
	contactName?: string | null
	phone?: string | null
	email?: string | null
	address?: string | null
	tin?: string | null
	vatNumber?: string | null
	paymentTermDays?: number
	notes?: string | null
}

export type SupplierPaymentDetailMethod = "BANK" | "MOMO"
export type SupplierMomoNetwork = "MTN" | "VOD" | "ATL"

/** Payment destination as returned by the API; numbers are masked off the owning payload. */
export interface SupplierPaymentDetailView {
	id: string
	method: SupplierPaymentDetailMethod
	label: string | null
	accountName: string | null
	accountNumber: string | null
	accountNumberMasked: string | null
	bankName: string | null
	bankCode: string | null
	momoNetwork: SupplierMomoNetwork | null
	phone: string | null
	isDefault: boolean
	isActive: boolean
	createdAt: string
	updatedAt: string
}

export type PaymentDetailInput =
	| {
			method: "BANK"
			label?: string
			accountName: string
			accountNumber: string
			bankName: string
			bankCode?: string
			isDefault?: boolean
	  }
	| {
			method: "MOMO"
			label?: string
			accountName?: string
			momoNetwork: SupplierMomoNetwork
			phone: string
			isDefault?: boolean
	  }

export interface PaymentDetailUpdateInput {
	label?: string | null
	accountName?: string
	accountNumber?: string
	bankName?: string | null
	bankCode?: string | null
	momoNetwork?: SupplierMomoNetwork
	phone?: string
	isDefault?: boolean
	isActive?: boolean
}

export interface SupplierProductMapping {
	id: string
	supplierId: string
	productId: string
	productSku: string
	productName: string
	supplierSku: string | null
	leadTimeDays: number | null
	lastCostMinor: number
	lastCostAt: string | null
	isPreferred: boolean
	createdAt: string
	updatedAt: string
}

export interface SupplierProductInput {
	productId: string
	supplierSku?: string
	leadTimeDays?: number
	isPreferred?: boolean
}

export interface SupplierProductUpdateInput {
	supplierSku?: string | null
	leadTimeDays?: number | null
	isPreferred?: boolean
}

export interface SupplierDetail {
	supplier: Supplier
	paymentDetails: SupplierPaymentDetailView[]
	products: SupplierProductMapping[]
}

export interface SupplierArchiveInput {
	note?: string
}

// --- Payables (supplier invoices, payments, balances, aging) ---

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
