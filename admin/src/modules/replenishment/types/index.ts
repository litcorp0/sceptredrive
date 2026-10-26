// --- Replenishment and supplier performance (Phase 11, Plan 10) ---
//
// These mirror the read models in `api/src/modules/replenishment/replenishment.types.ts`. The
// console renders every number the API returns, including the inputs behind a suggestion; it
// never derives a quantity, a rate or a value of its own.

import type { ReplenishmentBasis } from "@sceptre/shared"

/** The settings the API used, echoed so the screen can state them instead of hard-coding. */
export interface SuggestionSettings {
	velocityDays: number
	safetyDays: number
	defaultLeadDays: number
}

/** One `stock_threshold` row joined to the facts a suggestion used. */
export interface ReplenishmentRow {
	productId: string
	sku: string
	name: string
	supplierId: string | null
	supplierName: string | null
	leadTimeDays: number
	leadTimeAssumed: boolean
	minLevel: number
	maxLevel: number | null
	minOrderQuantity: number
	onHand: number
	onOrder: number
	unitsSold: number
	velocityDays: number
	targetLevel: number
	coverageLevel: number
	position: number
	suggested: number
	basis: ReplenishmentBasis
	lastCostMinor: number
	suggestedValueMinor: number
}

export interface ReplenishmentGroup {
	/** Empty string for the Unassigned group; the console owns the word "Unassigned". */
	supplierId: string
	supplierName: string
	/** The longest lead time in the group; each row's own value is exact. */
	leadTimeDays: number
	/** True when at least one row's lead time came from the default setting. */
	leadTimeAssumed: boolean
	rows: ReplenishmentRow[]
	suggestedUnits: number
	totalValueMinor: number
}

export interface ReplenishmentTotals {
	rows: number
	suggestedUnits: number
	valueMinor: number
}

export interface ReplenishmentResult {
	branchId: string
	velocityDays: number
	settings: SuggestionSettings
	groups: ReplenishmentGroup[]
	unassigned: ReplenishmentGroup
	totals: ReplenishmentTotals
	/** Rows matching the filter before `limit`/`offset`, so a truncated page says so. */
	totalRows: number
}

export interface SuggestionQuery {
	branchId?: string
	supplierId?: string
	onlySuggested: boolean
	q?: string
	limit: number
	offset: number
}

/** One supplier, measured over the selected window. */
export interface SupplierPerformanceRow {
	supplierId: string
	supplierCode: string
	supplierName: string
	ordersCount: number
	linesCount: number
	onTimeLines: number
	lateLines: number
	/** Lines with no expected date: unmeasurable, counted so the denominator is visible. */
	noPromiseLines: number
	/** Lines with a promise but no receipt yet: excluded from the rate, named here. */
	noReceiptLines: number
	onTimeRateBasisPoints: number | null
	orderedUnits: number
	receivedUnits: number
	fillRateBasisPoints: number | null
	/** Tenths of a day; the console divides by 10 for display only. */
	promisedLeadDaysAverageTenths: number | null
	actualLeadDaysAverageTenths: number | null
	lastCostDriftMinor: number | null
	lastCostDriftBasisPoints: number | null
	lastCostAt: string | null
	driftComparableProducts: number
}

export interface SupplierPerformanceTotals {
	suppliers: number
	onTimeRateBasisPoints: number | null
	fillRateBasisPoints: number | null
}

export interface SupplierPerformanceExclusions {
	ordersWithoutSendDate: number
	linesWithoutReceipt: number
}

export interface SupplierPerformanceResult {
	branchId: string
	from: string
	to: string
	suppliers: SupplierPerformanceRow[]
	totals: SupplierPerformanceTotals
	exclusions: SupplierPerformanceExclusions
}

export interface PerformanceQuery {
	branchId?: string
	supplierId?: string
	from?: string
	to?: string
}
