import type { OrderListQuery, ReturnListQuery } from "../types"

/**
 * Every key the procurement module owns.
 *
 * The roots are new (`["procurement-orders"]`, `["procurement-returns"]`): the module is a
 * Phase 11 section, not a migrated Phase 8 one, so there is no historical spelling to preserve.
 * Approval keys live in `modules/approvals` now; this module invalidates that root through the
 * approvals barrel.
 */
export const orderKeys = {
	all: ["procurement-orders"] as const,
	list: (query: OrderListQuery) => [...orderKeys.all, "list", query] as const,
	byId: (id: string) => [...orderKeys.all, "detail", id] as const,
	matchable: (supplierId: string, branchId: string | null) =>
		[...orderKeys.all, "matchable", supplierId, branchId] as const,
}

export const returnKeys = {
	all: ["procurement-returns"] as const,
	list: (query: ReturnListQuery) => [...returnKeys.all, "list", query] as const,
	byId: (id: string) => [...returnKeys.all, "detail", id] as const,
	returnable: (receiptId: string) => [...returnKeys.all, "returnable", receiptId] as const,
}
