import { StatusBadge } from "#/components/common/status-badge"
import type { SupplierPaymentMethod } from "#/modules/payables"

export function PaymentMethodBadge({ method }: { method: SupplierPaymentMethod }) {
	if (method === "CASH") return <StatusBadge tone="green">Cash</StatusBadge>
	if (method === "BANK") return <StatusBadge tone="blue">Bank</StatusBadge>
	return <StatusBadge tone="amber">MoMo</StatusBadge>
}
