import type { AnalyticsQuery, ReportQuery } from "../types"

/**
 * One root key for every analytics query. A report key puts the whole filter object in the
 * key, so two periods of the same report are distinct cache entries and a tab switch back is
 * instant.
 */
export const analyticsKeys = {
	all: ["analytics"] as const,
	report: (name: string, query: AnalyticsQuery | ReportQuery) =>
		[...analyticsKeys.all, name, query] as const,
}
