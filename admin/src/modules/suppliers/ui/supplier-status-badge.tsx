import { ActiveBadge, StatusBadge } from "#/components/common/status-badge"
import type { SupplierStatus } from "../types"

/**
 * The supplier status badge: an active supplier renders the shared active badge, an archived one
 * the muted "Archived" badge. Both the list row and the detail header render exactly this pair, so
 * they cannot drift apart.
 */
export function SupplierStatusBadge({ status }: { status: SupplierStatus }) {
	if (status === "ARCHIVED") return <StatusBadge tone="zinc">Archived</StatusBadge>
	return <ActiveBadge active />
}
