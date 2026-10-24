import { queryOptions } from "@tanstack/react-query"
import { apiRequest } from "#/lib/api"
import type { CountCreateInput, CountListQuery, StockCount } from "../types"
import { countKeys } from "./keys"

export function countListOptions(query: CountListQuery = {}) {
	return queryOptions({
		queryKey: countKeys.list(query),
		queryFn: () =>
			apiRequest<{ counts: StockCount[]; total: number; branchId: string | null }>("/api/counts", {
				query,
			}),
	})
}

export function countDetailOptions(id: string) {
	return queryOptions({
		queryKey: countKeys.detail(id),
		queryFn: () => apiRequest<{ count: StockCount }>(`/api/counts/${id}`),
	})
}

export function createCount(input: CountCreateInput) {
	return apiRequest<{ count: StockCount }>("/api/counts", { method: "POST", body: input })
}

export function updateCountLines(
	id: string,
	lines: { productId: string; countedQty: number | null }[],
) {
	return apiRequest<{ count: StockCount }>(`/api/counts/${id}/lines`, {
		method: "PATCH",
		body: { lines },
	})
}

export function postCount(id: string) {
	return apiRequest<{ count: StockCount }>(`/api/counts/${id}/post`, { method: "POST" })
}

export function cancelCount(id: string) {
	return apiRequest<{ ok: true }>(`/api/counts/${id}/cancel`, { method: "POST" })
}
