import type { ApprovalListQuery } from "../types"

/**
 * Every key the approvals module owns.
 *
 * One root (`["approvals"]`) so a decision invalidates the inbox, the detail, the badge and the
 * manager's operations page together. `summary` is keyed by branch because an admin's badge is
 * the branch they are looking at; a manager always resolves to their own branch on the server.
 */
export const approvalKeys = {
	all: ["approvals"] as const,
	list: (query: ApprovalListQuery) => [...approvalKeys.all, "list", query] as const,
	byId: (id: string) => [...approvalKeys.all, "detail", id] as const,
	summary: (branchId: string | null) => [...approvalKeys.all, "summary", branchId] as const,
}
