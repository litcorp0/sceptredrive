import { z } from "zod"
import type { TransferStatus } from "../types"

/** The statuses a transfer can hold, in the order it moves through them. */
export const TRANSFER_STATUSES: readonly TransferStatus[] = [
	"DRAFT",
	"REQUESTED",
	"APPROVED",
	"REJECTED",
	"DISPATCHED",
	"RECEIVED",
	"SHORT_CLOSED",
	"CANCELLED",
]

export const TRANSFER_STATUS_LABELS: Record<TransferStatus, string> = {
	DRAFT: "Draft",
	REQUESTED: "Awaiting approval",
	APPROVED: "Approved",
	REJECTED: "Rejected",
	DISPATCHED: "Dispatched",
	RECEIVED: "Received",
	SHORT_CLOSED: "Short closed",
	CANCELLED: "Cancelled",
}

/**
 * The list's filters live in the URL, so the operations page can link to the exact queue it
 * counted. `branchId` is an admin's filter; a manager's scope is decided by the API.
 */
export const transferSearchSchema = z.object({
	status: z
		.enum([
			"DRAFT",
			"REQUESTED",
			"APPROVED",
			"REJECTED",
			"DISPATCHED",
			"RECEIVED",
			"SHORT_CLOSED",
			"CANCELLED",
		])
		.optional()
		.catch(undefined),
	branchId: z.uuid().optional().catch(undefined),
})

export type TransferSearch = z.infer<typeof transferSearchSchema>

export const transferSearchDefaults = {} as const
