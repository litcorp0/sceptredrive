import { StatusBadge } from "#/components/common/status-badge"
import type { SupplierInvoiceStatus } from "#/modules/payables"

/**
 * A purchase invoice's status, shown both on the payables screens and on the goods receipt it was
 * recorded against. It lives in `components/common` so the inventory receipt screen does not
 * import a payables component: the badge is an identity chip, not a screen. The status union is
 * still payables' (type-only import), because the API owns those four values.
 */
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
