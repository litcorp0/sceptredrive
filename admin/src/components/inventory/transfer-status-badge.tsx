import { StatusBadge } from "#/components/common/status-badge"
import type { TransferStatus } from "#/lib/api-types"

const META: Record<
	TransferStatus,
	{ label: string; tone: "green" | "zinc" | "amber" | "red" | "blue" }
> = {
	DRAFT: { label: "Draft", tone: "zinc" },
	DISPATCHED: { label: "Dispatched", tone: "blue" },
	RECEIVED: { label: "Received", tone: "green" },
	SHORT_CLOSED: { label: "Short closed", tone: "amber" },
	CANCELLED: { label: "Cancelled", tone: "red" },
}

export function TransferStatusBadge({ status }: { status: TransferStatus }) {
	const meta = META[status]
	return <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
}
