/**
 * Every key the E-VAT module owns. A retry invalidates the detail, the list, the summary and the
 * health line, because a refusal can move all four.
 */
export const evatKeys = {
	all: ["evat"] as const,
	submissions: ["evat-submissions"] as const,
	submission: ["evat-submission"] as const,
	summary: ["evat-summary"] as const,
	health: ["evat-health"] as const,

	list: (query: object) => [...evatKeys.submissions, query] as const,
	detail: (submissionId: string) => [...evatKeys.submission, submissionId] as const,
}
