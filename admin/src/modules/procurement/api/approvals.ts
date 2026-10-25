import { queryOptions } from "@tanstack/react-query"
import { apiRequest } from "#/lib/api"
import type {
	ApprovalDecisionInput,
	ApprovalDetail,
	ApprovalListQuery,
	ApprovalListResult,
	ApprovalRow,
} from "../types"
import { approvalKeys } from "./keys"

/**
 * `GET /api/approvals` — the decision queue.
 *
 * The list is branch-scoped by the API: a manager sees their own branch, an admin sees the
 * caller's filter or everything. The console never filters after the fact.
 */
export function listApprovals(query: ApprovalListQuery = {}) {
	return apiRequest<ApprovalListResult>("/api/approvals", { query })
}

export function approvalListOptions(query: ApprovalListQuery = {}) {
	return queryOptions({
		queryKey: approvalKeys.list(query),
		queryFn: () => listApprovals(query),
	})
}

/** `GET /api/approvals/:id` — the subject and this actor's `canDecide`/`canWithdraw`. */
export function getApproval(id: string) {
	return apiRequest<ApprovalDetail>(`/api/approvals/${id}`)
}

export function approvalDetailOptions(id: string | null) {
	return queryOptions({
		queryKey: approvalKeys.byId(id ?? ""),
		queryFn: () => getApproval(id as string),
		enabled: Boolean(id),
	})
}

/** A rejection without a reason code is refused by the server, so the dialog asks first. */
export function decideApproval(id: string, input: ApprovalDecisionInput) {
	return apiRequest<ApprovalDetail>(`/api/approvals/${id}/decide`, {
		method: "POST",
		body: input,
	})
}

export function withdrawApproval(id: string) {
	return apiRequest<{ approval: ApprovalRow }>(`/api/approvals/${id}/withdraw`, {
		method: "POST",
	})
}
