import { z } from "zod"
import type { StatusVariant } from "#/components/common/status-badge"
import type { WriteOffReason, WriteOffStatus } from "../types"

/** The write-off vocabulary, in one place so the list and the approval subject agree. */
export const WRITE_OFF_STATUS_LABELS: Record<WriteOffStatus, string> = {
	PENDING_APPROVAL: "Awaiting decision",
	APPROVED: "Posted",
	REJECTED: "Rejected",
	CANCELLED: "Cancelled",
}

export function writeOffStatusLabel(status: WriteOffStatus): string {
	return WRITE_OFF_STATUS_LABELS[status]
}

export function writeOffStatusTone(status: WriteOffStatus): StatusVariant {
	switch (status) {
		case "PENDING_APPROVAL":
			return "warn"
		case "APPROVED":
			return "ok"
		case "REJECTED":
			return "danger"
		default:
			return "muted"
	}
}

export const WRITE_OFF_REASON_LABELS: Record<WriteOffReason, string> = {
	DAMAGE: "Damaged",
	EXPIRY: "Expired",
	OBSOLESCENCE: "Obsolete",
	THEFT: "Stolen",
	SUPPLIER_FAULT: "Supplier fault",
	OTHER: "Other",
}

export function writeOffReasonLabel(reason: WriteOffReason): string {
	return WRITE_OFF_REASON_LABELS[reason]
}

/** The order the form offers them, matching the API's enum. */
export const WRITE_OFF_REASONS: readonly WriteOffReason[] = [
	"DAMAGE",
	"EXPIRY",
	"OBSOLESCENCE",
	"THEFT",
	"SUPPLIER_FAULT",
	"OTHER",
]

/**
 * The server refuses a `THEFT` or `OTHER` line without a note, because "not otherwise
 * explained" needs an explanation (P12-D16). The form mirrors it and names the product.
 */
export function writeOffReasonNeedsNote(reason: WriteOffReason): boolean {
	return reason === "THEFT" || reason === "OTHER"
}

/** The statuses the list offers, in the order a document moves through them. */
export const WRITE_OFF_STATUSES: readonly WriteOffStatus[] = [
	"PENDING_APPROVAL",
	"APPROVED",
	"REJECTED",
	"CANCELLED",
]

/** The list's filters live in the URL, so a queue can be linked to directly. */
export const writeOffSearchSchema = z.object({
	status: z
		.enum(["PENDING_APPROVAL", "APPROVED", "REJECTED", "CANCELLED"])
		.optional()
		.catch(undefined),
	branchId: z.uuid().optional().catch(undefined),
	offset: z.coerce.number().int().min(0).optional().catch(undefined),
})

export type WriteOffSearch = z.infer<typeof writeOffSearchSchema>

export const writeOffSearchDefaults = {} as const
