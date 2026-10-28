import { TRANSFER_STATUS_LABELS, type TransferStatus } from "@sceptre/shared"
import { StatusBadge, type StatusVariant } from "#/components/common/status-badge"

/**
 * The transfer status vocabulary is the shared one, so the console cannot invent a word the API
 * does not use. `AWAITING_OTP` is attention, not failure: Paystack is holding the instruction
 * because a human still has to confirm it. `REVERSED` is danger: money came back.
 */
export function transferStatusVariant(status: TransferStatus): StatusVariant {
	switch (status) {
		case "SUCCESS":
			return "ok"
		case "AWAITING_OTP":
			return "warn"
		case "PENDING":
			return "info"
		case "FAILED":
		case "BLOCKED":
		case "REJECTED":
		case "REVERSED":
			return "danger"
	}
}

export function TransferStatusBadge({ status }: { status: TransferStatus }) {
	return (
		<StatusBadge variant={transferStatusVariant(status)}>
			{TRANSFER_STATUS_LABELS[status]}
		</StatusBadge>
	)
}
