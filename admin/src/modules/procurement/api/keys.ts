import type { ApprovalListQuery, OrderListQuery, ReturnListQuery } from "../types"

/**
 * Every key the procurement module owns.
 *
 * The roots are new (`["procurement-orders"]`, `["procurement-returns"]`, `["approvals"]`): the
 * module is a Phase 11 section, not a migrated Phase 8 one, so there is no historical spelling to
 * preserve. A decision invalidates its root so the order, its list row and the pending panel all
 * refresh together.
 */
export const orderKeys = {
	all: ["procurement-orders"] as const,
	list: (query: OrderListQuery) => [...orderKeys.all, "list", query] as const,
	byId: (id: string) => [...orderKeys.all, "detail", id] as const,
	matchable: (supplierId: string, branchId: string | null) =>
		[...orderKeys.all, "matchable", supplierId, branchId] as const,
}

export const approvalKeys = {
	all: ["approvals"] as const,
	list: (query: ApprovalListQuery) => [...approvalKeys.all, "list", query] as const,
	byId: (id: string) => [...approvalKeys.all, "detail", id] as const,
}

export const returnKeys = {
	all: ["procurement-returns"] as const,
	list: (query: ReturnListQuery) => [...returnKeys.all, "list", query] as const,
	byId: (id: string) => [...returnKeys.all, "detail", id] as const,
	returnable: (receiptId: string) => [...returnKeys.all, "returnable", receiptId] as const,
}
