import type { CreditEntryKind } from "../types"

/** The paging/filter block the ledger table hands to the entries read. */
export type CreditEntryFilters = {
	from?: string
	to?: string
	kind?: CreditEntryKind
	page: number
	pageSize: number
}

/**
 * Every key the credit module owns.
 *
 * The roots are spelled exactly as they were before Phase 8 — `["credit-profiles"]`,
 * `["credit-entries"]`, `["aging"]` and `["statement"]` — because the dialogs invalidate them by
 * prefix from several places and the customer profile reads the profile key by hand. A renamed
 * root would still typecheck and still render, but the ledger and the aging report would stop
 * refreshing after a posting.
 */
export const creditKeys = {
	profiles: ["credit-profiles"] as const,
	entries: ["credit-entries"] as const,
	aging: ["aging"] as const,
	statement: ["statement"] as const,
	overLimit: ["credit-over-limit"] as const,

	profileList: (customerId: string) => [...creditKeys.profiles, customerId] as const,
	entryList: (customerId: string, branchId: string | null, filters: CreditEntryFilters) =>
		[...creditKeys.entries, customerId, branchId, filters] as const,
	agingReport: (branchId: string | null, asOf: string) =>
		[...creditKeys.aging, branchId, asOf] as const,
	statementFor: (customerId: string, branchId: string | null, from: string, to: string) =>
		[...creditKeys.statement, customerId, branchId, from, to] as const,
	overLimitList: (branchId: string | null, limit: number, offset: number) =>
		[...creditKeys.overLimit, branchId, limit, offset] as const,
}
