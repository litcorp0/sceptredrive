import { EVAT_STATUS_LABELS, type EvatSubmissionStatus } from "@sceptre/shared"
import { StatusBadge } from "#/components/common/status-badge"
import { evatStatusVariant } from "../utils/labels"

export function EvatStatusBadge({ status }: { status: EvatSubmissionStatus }) {
	return <StatusBadge variant={evatStatusVariant(status)}>{EVAT_STATUS_LABELS[status]}</StatusBadge>
}

/** The deadline is a second fact, not a status: a row can be retrying and overdue at once. */
export function OverdueBadge({ overdue }: { overdue: boolean }) {
	if (!overdue) return null
	return <StatusBadge variant="danger">Overdue</StatusBadge>
}
