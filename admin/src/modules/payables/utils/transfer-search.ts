import { TRANSFER_STATUSES } from "@sceptre/shared"
import { z } from "zod"

/**
 * The transfer list and the reconciliation live in the URL.
 *
 * `.catch()` rather than `.default()` on every filter: a hand-edited or truncated link renders
 * the page with a sane fallback instead of throwing. The API validates the values again, and a
 * manager's branch scope is still the server's decision.
 */
export const transferSearchSchema = z.object({
	status: z.enum(TRANSFER_STATUSES).optional().catch(undefined),
	supplierId: z.uuid().optional().catch(undefined),
	/** `ALL` is the explicit "every branch" choice; absence follows the shell's branch. */
	branchId: z
		.union([z.uuid(), z.literal("ALL")])
		.optional()
		.catch(undefined),
	from: z.iso.date().optional().catch(undefined),
	to: z.iso.date().optional().catch(undefined),
	offset: z.coerce.number().int().min(0).optional().catch(undefined),
	/** A row on a supplier's payment details can link straight into the transfer dialog. */
	dialog: z.literal("transfer").optional().catch(undefined),
	paymentDetailId: z.uuid().optional().catch(undefined),
})

export type TransferSearch = z.infer<typeof transferSearchSchema>

export const RECONCILIATION_STATES = ["manual", "settled", "unposted"] as const

export const reconciliationSearchSchema = z.object({
	state: z.enum(RECONCILIATION_STATES).optional().catch(undefined),
	branchId: z
		.union([z.uuid(), z.literal("ALL")])
		.optional()
		.catch(undefined),
	from: z.iso.date().optional().catch(undefined),
	to: z.iso.date().optional().catch(undefined),
})

export type ReconciliationSearch = z.infer<typeof reconciliationSearchSchema>
