import type { CustomerLoyaltySummary } from "#/modules/loyalty"

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

/** The credit profile as the customer read returns it — a projection of `modules/credit`. */
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

export interface CustomerDetail {
	customer: CustomerListRow
	creditProfiles: CustomerCreditProfileRow[]
	/** Loyalty owns the type and the balance; the profile only embeds it. */
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
