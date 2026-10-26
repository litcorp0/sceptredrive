import { queryOptions } from "@tanstack/react-query"
import { apiRequest } from "#/lib/api"
import type {
	PerformanceQuery,
	ReplenishmentResult,
	SuggestionQuery,
	SupplierPerformanceResult,
} from "../types"
import { performanceKeys, replenishmentKeys } from "./keys"

/** `GET /api/replenishment/suggestions` — grouped suggestions with every input they used. */
export function suggestionsOptions(query: SuggestionQuery) {
	return queryOptions({
		queryKey: replenishmentKeys.suggestions(query),
		queryFn: () => apiRequest<ReplenishmentResult>("/api/replenishment/suggestions", { query }),
	})
}

/** `GET /api/replenishment/suppliers/performance` — the window defaults to 90 days server-side. */
export function performanceOptions(query: PerformanceQuery) {
	return queryOptions({
		queryKey: performanceKeys.list(query),
		queryFn: () =>
			apiRequest<SupplierPerformanceResult>("/api/replenishment/suppliers/performance", {
				query,
			}),
	})
}
