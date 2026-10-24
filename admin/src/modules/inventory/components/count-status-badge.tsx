import { StatusBadge } from "#/components/common/status-badge"
import type { StockCountStatus } from "../types"

const META: Record<StockCountStatus, { label: string; tone: "green" | "zinc" | "blue" }> = {
	OPEN: { label: "Open", tone: "blue" },
	POSTED: { label: "Posted", tone: "green" },
	CANCELLED: { label: "Cancelled", tone: "zinc" },
}

export function CountStatusBadge({ status }: { status: StockCountStatus }) {
	const meta = META[status]
	return <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
}
