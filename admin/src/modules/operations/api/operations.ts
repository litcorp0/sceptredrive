import { queryOptions } from "@tanstack/react-query"
import { apiRequest } from "#/lib/api"
import type { OperationsSummary } from "../types"
import { operationsKeys } from "./keys"

/**
 * `GET /api/operations/summary` — six queues and the count-accuracy figure in one read.
 *
 * The API decides which sections this actor may see and scopes each one to their branch a second
 * time. The console renders what is present and never fills a missing section with zero.
 */
export function operationsSummaryOptions(branchId: string | null) {
	return queryOptions({
		queryKey: operationsKeys.summary(branchId),
		queryFn: () =>
			apiRequest<OperationsSummary>("/api/operations/summary", {
				query: { branchId: branchId ?? undefined },
			}),
	})
}
