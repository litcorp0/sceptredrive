import type { StaffListQuery } from "../types"

/**
 * Every key the staff module owns. The root stays `['staff']` so the four pre-Phase-8
 * invalidations (`queryClient.invalidateQueries({ queryKey: ['staff'] })`) still match the
 * filtered list entry.
 */
export const staffKeys = {
	all: ["staff"] as const,
	list: (query: StaffListQuery) => [...staffKeys.all, query] as const,
}
