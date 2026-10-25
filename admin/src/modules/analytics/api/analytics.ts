import { type QueryClient, queryOptions } from "@tanstack/react-query"
import { apiDownload, apiRequest } from "#/lib/api"
import type {
	AnalyticsQuery,
	ExportName,
	OverviewResponse,
	ProductsResponse,
	ReportQuery,
	SalesResponse,
	TaxResponse,
} from "../types"
import { analyticsKeys } from "./keys"

export function analyticsOverviewOptions(query: AnalyticsQuery) {
	return queryOptions({
		queryKey: analyticsKeys.report("overview", query),
		queryFn: () => apiRequest<OverviewResponse>("/api/analytics/overview", { query }),
		staleTime: 60_000,
	})
}

export function analyticsSalesOptions(query: ReportQuery) {
	return queryOptions({
		queryKey: analyticsKeys.report("sales", query),
		queryFn: () => apiRequest<SalesResponse>("/api/analytics/sales", { query }),
		staleTime: 60_000,
	})
}

export function analyticsProductsOptions(query: ReportQuery) {
	return queryOptions({
		queryKey: analyticsKeys.report("products", query),
		queryFn: () => apiRequest<ProductsResponse>("/api/analytics/products", { query }),
		staleTime: 60_000,
	})
}

export function analyticsTaxOptions(query: ReportQuery) {
	return queryOptions({
		queryKey: analyticsKeys.report("tax", query),
		queryFn: () => apiRequest<TaxResponse>("/api/analytics/tax", { query }),
		staleTime: 60_000,
	})
}

/**
 * Reports added by plans 04 live behind the same key factory; their response types are
 * declared next to the tab that renders them (`ReportResponse` below is the shared envelope
 * every one of them satisfies).
 */
export function analyticsReportOptions<T>(name: ExportName, query: ReportQuery) {
	return queryOptions({
		queryKey: analyticsKeys.report(name, query),
		queryFn: () => apiRequest<T>(`/api/analytics/${name}`, { query }),
		staleTime: 60_000,
	})
}

/** Downloads a CSV produced by the API; the browser never assembles a report. */
export async function downloadReport(
	name: ExportName,
	query: AnalyticsQuery,
): Promise<{ blob: Blob; filename: string }> {
	return apiDownload(`/api/analytics/${name}/export`, query)
}

/** Nothing mutates analytics, so the only invalidation is a manual refresh. */
export function refreshAnalytics(client: QueryClient): Promise<void> {
	return client.invalidateQueries({ queryKey: analyticsKeys.all })
}
