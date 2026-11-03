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
	/** Decimal degrees; null when nobody has pinned the door yet. */
	latitude: number | null
	longitude: number | null
	isActive: boolean
	createdBy: string | null
	createdAt: string
	updatedAt: string
}

export interface SuggestCode {
	code: string
	adjusted: boolean
}

/**
 * `GET /api/branches/directory` — every active branch, unscoped.
 *
 * The branch switcher keeps using `/api/branches` (a manager sees only their own branch). A
 * transfer request needs to name any active source, so the API publishes this deliberately
 * unscoped list to callers with `branch.read`.
 */
export type BranchDirectoryEntry = Pick<Branch, "id" | "code" | "name" | "type">

export interface BranchCreateInput {
	/** Omit to let the API generate it from type, city and area. */
	code?: string
	name: string
	type: BranchType
	city: string
	area?: string
	address?: string
	phone?: string
	latitude?: number
	longitude?: number
}

export interface BranchUpdateInput {
	name?: string
	city?: string
	area?: string
	address?: string
	phone?: string
	/** `null` clears a wrong pin; omitting the key leaves it alone. */
	latitude?: number | null
	longitude?: number | null
}

export type BranchListQuery = {
	includeInactive?: boolean
}
