import type { PurchaseOrderStatus } from "@sceptre/shared"
import { StatusBadge } from "#/components/common/status-badge"
import { statusLabel, statusTone } from "../utils/order"

/**
 * An order's lifecycle state. Presentational only — the label carries the state, the tint is
 * decoration (WCAG 2.2 SC 1.4.1).
 */
export function OrderStatusBadge({ status }: { status: PurchaseOrderStatus }) {
	return <StatusBadge variant={statusTone(status)}>{statusLabel(status)}</StatusBadge>
}
