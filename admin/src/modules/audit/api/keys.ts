import type { AuditListQuery } from "../types"

/**
 * Every key the audit module owns. The root stays `["audit"]` so a query invalidation written
 * before Phase 8 still matches.
 */
export const auditKeys = {
	all: ["audit"] as const,
	list: (query: AuditListQuery) => [...auditKeys.all, query] as const,
	/**
	 * The dashboard's six-entry feed. The key is kept byte-identical to the pre-Phase-8
	 * `["audit", { scope: "dashboard" }]` so the cache entry is the same one it always was.
	 */
	recent: () => [...auditKeys.all, { scope: "dashboard" }] as const,
}
