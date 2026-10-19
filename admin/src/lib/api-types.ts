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
	createdAt: string
	updatedAt: string
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
	| "staff.idPrefix"
	| "staff.idSequence"
	| "receipt.header"
	| "loyalty.earnPointsPerCedi"
	| "loyalty.pointsPerCedi"
	| "loyalty.expiryMonths"
	| "catalog.skuPrefix"
	| "catalog.skuSequence"
	| "pricing.taxMode"

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
