/** Keys the operations module owns. The summary is per branch: a switch is a different read. */
export const operationsKeys = {
	all: ["operations"] as const,
	summary: (branchId: string | null) => [...operationsKeys.all, "summary", branchId] as const,
}
