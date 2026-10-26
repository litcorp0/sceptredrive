import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { StatusNote } from "#/components/common/status-note"
import { approvalListOptions } from "#/modules/approvals"

/**
 * A pending limit request for one credit profile, on the customer's credit card.
 *
 * The request is keyed by the profile id, not the customer id: the same customer's limit at
 * another branch is a different decision (P12-D22). `enabled` keeps the query quiet until a
 * profile exists at the selected branch.
 */
export function PendingLimitNote({ profileId }: { profileId: string | null }) {
	const pendingQuery = useQuery({
		...approvalListOptions({
			type: "CREDIT_LIMIT_CHANGE",
			status: "PENDING",
			entityId: profileId ?? undefined,
			limit: 1,
			offset: 0,
		}),
		enabled: profileId !== null,
	})

	const pending = pendingQuery.data?.approvals[0]
	if (!pending) return null

	return (
		<StatusNote tone="info" title="A limit increase is waiting for an admin">
			The current limit stays in force until the request is decided.{" "}
			<Link
				to="/approvals/$approvalId"
				params={{ approvalId: pending.id }}
				className="font-medium text-primary hover:underline"
			>
				Review the request
			</Link>
		</StatusNote>
	)
}
