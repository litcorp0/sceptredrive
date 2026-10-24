import { queryOptions } from "@tanstack/react-query"
import { apiRequest } from "#/lib/api"
import type {
	Branch,
	BranchCreateInput,
	BranchListQuery,
	BranchType,
	BranchUpdateInput,
	SuggestCode,
} from "../types"
import { branchKeys } from "./keys"

export function branchListOptions(query: BranchListQuery = {}) {
	return queryOptions({
		queryKey: branchKeys.list(query),
		queryFn: () => apiRequest<{ branches: Branch[] }>("/api/branches", { query }),
	})
}

export function branchDetailOptions(id: string) {
	return queryOptions({
		queryKey: branchKeys.detail(id),
		queryFn: () => apiRequest<{ branch: Branch }>(`/api/branches/${id}`),
	})
}

export function createBranch(input: BranchCreateInput) {
	return apiRequest<{ branch: Branch }>("/api/branches", { method: "POST", body: input })
}

export function updateBranch(id: string, input: BranchUpdateInput) {
	return apiRequest<{ branch: Branch }>(`/api/branches/${id}`, { method: "PATCH", body: input })
}

export function deactivateBranch(id: string) {
	return apiRequest<{ branch: Branch }>(`/api/branches/${id}/deactivate`, { method: "POST" })
}

export function suggestBranchCode(query: { city: string; area?: string; type: BranchType }) {
	return apiRequest<SuggestCode>("/api/branches/suggest-code", { query })
}
