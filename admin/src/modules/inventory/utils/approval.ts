import type { ApprovalReasonCode, ApprovalStatus } from "@sceptre/shared"
import type { StatusVariant } from "#/components/common/status-badge"

/**
 * The approval vocabulary the inventory screens need.
 *
 * The approvals module owns the inbox's words, but it imports this module's subject readers
 * (`transferDetailOptions`, `writeOffDetailOptions`). Importing its barrel back from here would
 * close a module cycle, so the handful of strings a transfer or write-off card prints live beside
 * the documents they describe. The machine values still come from `@sceptre/shared`.
 */
export const TRANSFER_APPROVAL_STATUS_LABELS: Record<ApprovalStatus, string> = {
	PENDING: "Awaiting approval",
	APPROVED: "Approved",
	REJECTED: "Rejected",
	WITHDRAWN: "Withdrawn",
}

export function approvalStatusLabel(status: ApprovalStatus): string {
	return TRANSFER_APPROVAL_STATUS_LABELS[status]
}

export function approvalStatusTone(status: ApprovalStatus): StatusVariant {
	switch (status) {
		case "PENDING":
			return "warn"
		case "APPROVED":
			return "ok"
		case "REJECTED":
			return "danger"
		default:
			return "muted"
	}
}

export const APPROVAL_REASON_LABELS: Record<ApprovalReasonCode, string> = {
	OVER_THRESHOLD: "Over the threshold",
	PRICE_TOO_HIGH: "Price too high",
	OUT_OF_POLICY: "Out of policy",
	INCOMPLETE: "Incomplete",
	DUPLICATE: "Duplicate",
	OTHER: "Other",
}

/** `—` for an approval with no reason recorded (an approval may omit one). */
export function approvalReasonLabel(code: ApprovalReasonCode | null): string {
	return code ? APPROVAL_REASON_LABELS[code] : "—"
}
