import { queryOptions } from "@tanstack/react-query"
import { apiRequest } from "#/lib/api"
import type { AuditListQuery, AuditListResult } from "../types"
import { auditKeys } from "./keys"

/** `GET /api/audit` — the filtered, paginated log. */
export function auditListOptions(query: AuditListQuery) {
	return queryOptions({
		queryKey: auditKeys.list(query),
		queryFn: () => apiRequest<AuditListResult>("/api/audit", { query }),
	})
}

/** The dashboard's feed: the newest six entries, whatever their action or entity. */
export function auditRecentOptions() {
	return queryOptions({
		queryKey: auditKeys.recent(),
		queryFn: () => apiRequest<AuditListResult>("/api/audit", { query: { limit: 6 } }),
	})
}
