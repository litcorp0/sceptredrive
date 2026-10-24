// --- Suppliers (master, payment details, supplied products) ---

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
