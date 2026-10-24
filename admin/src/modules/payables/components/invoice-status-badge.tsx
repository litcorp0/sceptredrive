import { StatusBadge } from "#/components/common/status-badge"
import type { SupplierInvoiceStatus } from "../types"

export function InvoiceStatusBadge({
	status,
	overdue = false,
}: {
	status: SupplierInvoiceStatus
	overdue?: boolean
}) {
	if (status === "VOID") return <StatusBadge tone="zinc">Void</StatusBadge>
	if (status === "PAID") return <StatusBadge tone="green">Paid</StatusBadge>
	if (status === "PARTIAL") return <StatusBadge tone="amber">Partial</StatusBadge>
	return (
		<StatusBadge tone={overdue ? "red" : "blue"}>{overdue ? "Open · overdue" : "Open"}</StatusBadge>
	)
}
