/**
 * The settings module's only key root. `invalidateQueries({ queryKey: ["settings"] })` keeps
 * matching, exactly as it did before Phase 8.
 */
export const settingsKeys = {
	all: ["settings"] as const,
	list: (query: { branchId?: string }) => [...settingsKeys.all, query] as const,
}
