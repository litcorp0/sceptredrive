import { EVAT_DOCUMENT_KINDS, EVAT_SUBMISSION_STATUSES } from "@sceptre/shared"
import { z } from "zod"

/**
 * The E-VAT view lives in the URL, including which submission's sheet is open.
 *
 * `submissionId` in the URL makes a detail openable from a link, and `.catch()` keeps a
 * hand-edited id or a mistyped date rendering the page rather than throwing. The API validates
 * the values again.
 */
export const evatSearchSchema = z.object({
	status: z.enum(EVAT_SUBMISSION_STATUSES).optional().catch(undefined),
	kind: z.enum(EVAT_DOCUMENT_KINDS).optional().catch(undefined),
	/** A query value, not a boolean: `overdue=false` must mean "on time", not "absent". */
	overdue: z.enum(["true", "false"]).optional().catch(undefined),
	branchId: z
		.union([z.uuid(), z.literal("ALL")])
		.optional()
		.catch(undefined),
	from: z.iso.date().optional().catch(undefined),
	to: z.iso.date().optional().catch(undefined),
	offset: z.coerce.number().int().min(0).optional().catch(undefined),
	submissionId: z.uuid().optional().catch(undefined),
})

export type EvatSearch = z.infer<typeof evatSearchSchema>
