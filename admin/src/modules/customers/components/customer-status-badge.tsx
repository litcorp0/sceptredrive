import { ActiveBadge, StatusBadge } from "#/components/common/status-badge"
import type { CustomerListRow } from "../types"

/**
 * Identity status for the list row and the profile header. One row of the customer read decides
 * it: an anonymized identity outranks the archived flag, which outranks active.
 */
export function CustomerStatusBadge({ customer }: { customer: CustomerListRow }) {
	if (customer.anonymizedAt) return <StatusBadge tone="zinc">Anonymized</StatusBadge>
	if (customer.status === "ARCHIVED") return <StatusBadge tone="zinc">Archived</StatusBadge>
	return <ActiveBadge active />
}
