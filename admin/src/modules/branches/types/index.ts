export type BranchType = "RETAIL" | "WAREHOUSE"

/** A retail store or warehouse. The server owns the warehouse-vs-retail rule. */
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

export interface SuggestCode {
	code: string
	adjusted: boolean
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

export type BranchListQuery = {
	includeInactive?: boolean
}
