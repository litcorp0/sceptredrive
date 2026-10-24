import type { Role } from "@gikautos/shared"

/**
 * Response and input types mirroring the API contracts in `api/src/modules/*`.
 * Hand-maintained for Phase 1; a shared contracts package can replace this in
 * Phase 2 when catalog endpoints land.
 */

export type BranchType = "RETAIL" | "WAREHOUSE"
export type DeviceStatus = "ACTIVE" | "REVOKED"

export interface Branch {
	id: string
	code: string
	name: string
	type: BranchType
	city: string
	area: string | null
	address: string | null
	phone: string | null
	isActive: boolean
	createdBy: string | null
	createdAt: string
	updatedAt: string
}

export interface Terminal {
	id: string
	branchId: string
	code: string
	name: string
	isActive: boolean
	lastSeenAt: string | null
	createdBy: string | null
	createdAt: string
	updatedAt: string
}

export interface Device {
	id: string
	terminalId: string
	fingerprint: string
	status: DeviceStatus
	enrolledAt: string
	revokedAt: string | null
	lastSeenAt: string | null
}

export interface Staff {
	id: string
	name: string
	email: string
	role: Role
	branchId: string | null
	staffId: string | null
	phone: string | null
	isActive: boolean
	mustChangePassword: boolean
	twoFactorEnabled: boolean
	pinVersion: number
	pinMustChange: boolean
	createdAt: string
	updatedAt: string
}

/** PIN metadata from `/api/staff/:id/pin-status`; never includes the hash. */
export interface StaffPinStatus {
	hasPin: boolean
	pinVersion: number
	pinMustChange: boolean
	activeBindings: number
}

export interface SetStaffPinResult {
	staffId: string
	pinVersion: number
}

export interface AuditEntry {
	id: string
	actorId: string | null
	actorStaffId: string | null
	action: string
	entity: string
	entityId: string | null
	before: unknown
	after: unknown
	branchId: string | null
	terminalId: string | null
	ip: string | null
	userAgent: string | null
	requestId: string | null
	createdAt: string
}

export type SettingKey =
	| "auth.requireTwoFactor"
	| "staff.idPrefix"
	| "staff.idSequence"
	| "receipt.header"
	| "loyalty.earnPointsPerCedi"
	| "loyalty.pointsPerCedi"
	| "loyalty.expiryMonths"
	| "loyalty.minimumRedeemPoints"
	| "credit.repaymentPrefix"
	| "credit.repaymentSequence"
	| "catalog.skuPrefix"
	| "catalog.skuSequence"
	| "pricing.taxMode"
	| "supplier.codePrefix"
	| "supplier.codeSequence"
	| "payable.invoicePrefix"
	| "payable.invoiceSequence"
	| "payable.paymentPrefix"
	| "payable.paymentSequence"

export interface ResolvedSetting {
	key: SettingKey
	value: unknown
	branchScoped: boolean
	source: "branch" | "global" | "default"
}

export interface Enrollment {
	code: string
	expiresAt: string
}

export interface SuggestCode {
	code: string
	adjusted: boolean
}

export interface CreateStaffResult {
	staff: Staff
	temporaryPassword: string
	invitationSent: boolean
}

export interface ResetPasswordResult {
	temporaryPassword: string
	invitationSent: boolean
}

export interface BranchCreateInput {
	code: string
	name: string
	type: BranchType
	city: string
	area?: string
	address?: string
	phone?: string
}

export interface BranchUpdateInput {
	name?: string
	city?: string
	area?: string
	address?: string
	phone?: string
}

export interface TerminalCreateInput {
	branchId: string
	name: string
}

export interface TerminalUpdateInput {
	name?: string
	isActive?: boolean
}

export interface StaffCreateInput {
	email: string
	name: string
	role: Role
	branchId?: string | null
	phone?: string
}

export interface StaffUpdateInput {
	name?: string
	phone?: string
	role?: Role
	branchId?: string | null
}

export interface SetStaffPinInput {
	pin: string
}

export interface ChangePasswordInput {
	currentPassword: string
	newPassword: string
}

export type BranchListQuery = {
	includeInactive?: boolean
}

export type TerminalListQuery = {
	branchId?: string
	includeInactive?: boolean
}

export type StaffListQuery = {
	role?: Role
	branchId?: string
	includeInactive?: boolean
	search?: string
	limit?: number
	offset?: number
}

export type AuditListQuery = {
	actorId?: string
	actorStaffId?: string
	action?: string
	entity?: string
	entityId?: string
	branchId?: string
	from?: string
	to?: string
	limit?: number
	offset?: number
}

export interface SettingsUpdateInput {
	key: string
	value: unknown
	branchId?: string | null
}

export type TaxCategory = "STANDARD" | "ZERO_RATED" | "EXEMPT"
export type TaxMode = "INCLUSIVE" | "EXCLUSIVE"

export interface Category {
	id: string
	name: string
	parentId: string | null
	isActive: boolean
	createdBy: string | null
	createdAt: string
	updatedAt: string
}

export interface CategoryTreeNode extends Category {
	children: Category[]
}

export interface Brand {
	id: string
	name: string
	isActive: boolean
	createdBy: string | null
	createdAt: string
	updatedAt: string
}

export interface Uom {
	id: string
	code: string
	name: string
	isActive: boolean
	createdBy: string | null
	createdAt: string
	updatedAt: string
}

export interface ProductRow {
	id: string
	sku: string
	name: string
	description: string | null
	categoryId: string
	brandId: string | null
	uomId: string
	costPriceMinor: number
	basePriceMinor: number
	taxCategory: TaxCategory
	isActive: boolean
	createdBy: string | null
	createdAt: string
	updatedAt: string
}

export interface Barcode {
	id: string
	productId: string
	code: string
	createdBy: string | null
	createdAt: string
}

export interface PriceOverride {
	id: string
	productId: string
	branchId: string
	priceMinor: number
	updatedBy: string | null
	createdAt: string
	updatedAt: string
}

export interface ProductWithBarcodes extends ProductRow {
	barcodes: Barcode[]
}

export interface ProductDetail extends ProductWithBarcodes {
	overrides: PriceOverride[]
}

export interface Product {
	id: string
	sku: string
	name: string
	categoryId: string
	categoryName: string
	brandId: string | null
	brandName: string | null
	uomId: string
	uomCode: string
	uomName: string
	taxCategory: TaxCategory
	isActive: boolean
	basePriceMinor: number
	effectivePriceMinor: number | null
	barcodeCount: number
	updatedAt: string
}

export interface CategoryCreateInput {
	name: string
	parentId?: string | null
}

export interface CategoryUpdateInput {
	name?: string
	parentId?: string | null
}

export interface BrandCreateInput {
	name: string
}

export interface BrandUpdateInput {
	name: string
}

export interface UomCreateInput {
	code: string
	name: string
}

export interface UomUpdateInput {
	name: string
}

export interface ProductCreateInput {
	sku?: string
	name: string
	description?: string
	categoryId: string
	brandId?: string | null
	uomId: string
	costPriceMinor?: number
	basePriceMinor: number
	taxCategory?: TaxCategory
	barcodes?: string[]
}

export interface ProductUpdateInput {
	sku?: string
	name?: string
	description?: string
	categoryId?: string
	brandId?: string | null
	uomId?: string
	costPriceMinor?: number
	basePriceMinor?: number
	taxCategory?: TaxCategory
}

export type CatalogListQuery = {
	includeArchived?: boolean
}

export type ProductListQuery = {
	q?: string
	categoryId?: string
	brandId?: string
	includeArchived?: boolean
	branchId?: string
	limit?: number
	offset?: number
}

export type AdjustmentReason = "DAMAGE" | "LOSS" | "FOUND" | "CORRECTION" | "EXPIRED" | "OTHER"

export type StockMovementType =
	| "RECEIPT"
	| "ADJUSTMENT"
	| "TRANSFER_OUT"
	| "TRANSFER_IN"
	| "COUNT_VARIANCE"

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
	updatedBy: string | null
	updatedAt: string
}

export interface ThresholdInput {
	branchId: string
	productId: string
	threshold: number
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

export type CustomerStatus = "ACTIVE" | "ARCHIVED"

export interface CustomerListRow {
	id: string
	name: string
	phone: string | null
	email: string | null
	address: string | null
	status: CustomerStatus
	anonymizedAt: string | null
	createdBranchId: string
	createdBranchCode: string
	createdBranchName: string
	createdAt: string
	updatedAt: string
}

export interface CustomerCreditProfileRow {
	id: string
	branchId: string
	branchCode: string
	branchName: string
	limitMinor: number
	hold: boolean
	paymentTermDays: number
	balanceMinor: number
}

export interface CustomerLoyaltySummary {
	accountId: string
	balancePoints: number
}

export interface CustomerDetail {
	customer: CustomerListRow
	creditProfiles: CustomerCreditProfileRow[]
	loyalty: CustomerLoyaltySummary | null
}

export interface CustomerSearchResult {
	customers: CustomerListRow[]
	total: number
	page: number
	pageSize: number
}

export type CustomerListQuery = {
	q?: string
	page?: number
	pageSize?: number
	includeArchived?: boolean
	branchId?: string
}

export interface CustomerCreateInput {
	name: string
	phone: string
	email?: string
	address?: string
	/** Required when an admin creates (managers default to their own branch). */
	branchId?: string
}

export interface CustomerUpdateInput {
	name?: string
	phone?: string
	email?: string | null
	address?: string | null
}

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

export type LoyaltyEntryKind = "EARN" | "REDEEM" | "CLAWBACK" | "ADJUST" | "EXPIRE"
export type LoyaltyStaffKind = Exclude<LoyaltyEntryKind, "EXPIRE">
export type LoyaltyReasonCode = "EXPIRY" | "RETURN" | "CORRECTION" | "GOODWILL" | "OTHER"

export interface LoyaltyLot {
	id: string
	accountId: string
	earnEntryId: string
	points: number
	remainingPoints: number
	expiresAt: string
	createdAt: string
}

export interface LoyaltyEntry {
	id: string
	accountId: string
	customerId: string
	branchId: string | null
	kind: LoyaltyEntryKind
	pointsDelta: number
	reasonCode: LoyaltyReasonCode | null
	note: string | null
	referenceType: string | null
	referenceId: string | null
	referenceNumber: string | null
	idempotencyKey: string | null
	createdBy: string | null
	occurredAt: string
	createdAt: string
}

export interface LoyaltyAccountDetail {
	accountId: string
	customerId: string
	balancePoints: number
	lots: LoyaltyLot[]
	entries: LoyaltyEntry[]
	entryTotal: number
}

export interface LoyaltyAccount {
	id: string
	customerId: string
	balancePoints: number
	createdAt: string
	updatedAt: string
}

export interface RedeemQuote {
	points: number
	discountMinor: number
}

export interface LoyaltyPostingResult {
	/** Null when an earn floors to zero points (nothing is written). */
	entry: LoyaltyEntry | null
	account: LoyaltyAccount
	lot: LoyaltyLot | null
	consumption: Array<{
		id: string
		lotId: string
		entryId: string
		points: number
		createdAt: string
	}>
	quote: RedeemQuote | null
}

export interface LoyaltyEntryCreateInput {
	customerId: string
	branchId?: string
	kind: LoyaltyStaffKind
	/** EARN only: the net amount paid, in minor units. */
	netPaidMinor?: number
	/** Signed for ADJUST; positive for REDEEM/CLAWBACK (the server stores the sign). */
	points?: number
	reasonCode?: LoyaltyReasonCode
	note?: string
	idempotencyKey?: string
}

export interface LoyaltyBranchActivity {
	branchId: string | null
	earnedPoints: number
	redeemedPoints: number
	clawedBackPoints: number
	adjustedPoints: number
	expiredPoints: number
	netPoints: number
}

export interface LoyaltyNegativeBalance {
	customerId: string
	customerName: string
	branchId: string | null
	balancePoints: number
}

export interface LoyaltyLiabilityReport {
	asOf: string
	pointsPerCedi: number
	outstandingPoints: number
	outstandingValueMinor: number
	/** Remaining live points that expire within the next 30 days. */
	expiringSoonPoints: number
	activity: {
		from: string | null
		to: string | null
		branchId: string | null
		rows: LoyaltyBranchActivity[]
	}
	negativeBalances: LoyaltyNegativeBalance[]
}

export type LoyaltyLiabilityQuery = {
	branchId?: string
	from?: string
	to?: string
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
