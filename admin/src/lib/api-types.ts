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
