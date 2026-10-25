import type { ApprovalReasonCode } from "@sceptre/shared"
import type { ApprovalRow } from "../types"

/**
 * The words the approval screens share.
 *
 * The rate-card vocabulary (`OVER_THRESHOLD`, …) is the API's; the console shows a sentence and
 * keeps the code for the audit trail. Both the order panel and the product-submission panel read
 * a proposal through these helpers, so one `payload` cast cannot drift from the other.
 */
export const APPROVAL_REASON_LABELS: Record<ApprovalReasonCode, string> = {
	OVER_THRESHOLD: "Over the threshold",
	PRICE_TOO_HIGH: "Price too high",
	OUT_OF_POLICY: "Out of policy",
	INCOMPLETE: "Incomplete",
	DUPLICATE: "Duplicate",
	OTHER: "Other",
}

export function approvalReasonLabel(code: ApprovalReasonCode | null): string {
	return code ? APPROVAL_REASON_LABELS[code] : "no reason recorded"
}

/** A `PRODUCT_CREATE` payload is the API's validated submission body; read it defensively. */
export function proposalText(
	payload: Record<string, unknown>,
	key: string,
): string | null {
	const value = payload[key]
	return typeof value === "string" && value.trim().length > 0 ? value : null
}

export function proposalName(payload: Record<string, unknown>): string {
	return proposalText(payload, "name") ?? "Untitled proposal"
}

/** The proposed price is the approval's `amountMinor`; the payload is the fallback. */
export function proposalPriceMinor(approval: ApprovalRow): number | null {
	if (typeof approval.amountMinor === "number" && Number.isSafeInteger(approval.amountMinor)) {
		return approval.amountMinor
	}
	const proposed = approval.payload.proposedBasePriceMinor
	return typeof proposed === "number" && Number.isSafeInteger(proposed) ? proposed : null
}
