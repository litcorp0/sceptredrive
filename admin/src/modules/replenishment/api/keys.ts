import type { PerformanceQuery, SuggestionQuery } from "../types"

/**
 * Every key the replenishment module owns.
 *
 * The roots are new (`["replenishment"]`, `["supplier-performance"]`). A threshold edit or a
 * preferred-supplier change invalidates the whole replenishment root so the group and every row
 * behind it refresh together.
 */
export const replenishmentKeys = {
	all: ["replenishment"] as const,
	suggestions: (query: SuggestionQuery) =>
		[...replenishmentKeys.all, "suggestions", query] as const,
}

export const performanceKeys = {
	all: ["supplier-performance"] as const,
	list: (query: PerformanceQuery) => [...performanceKeys.all, "list", query] as const,
}
