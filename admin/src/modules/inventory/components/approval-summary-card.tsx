import { formatDateTime } from "@sceptre/shared"
import type { ApprovalReasonCode, ApprovalStatus } from "@sceptre/shared"
import { Link } from "@tanstack/react-router"
import { StatusBadge } from "#/components/common/status-badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card"
import { approvalReasonLabel, approvalStatusLabel, approvalStatusTone } from "../utils/approval"

/** The fields every document's approval row carries (transfer and write-off share this shape). */
export interface ApprovalSummaryFields {
	id: string
	status: ApprovalStatus
	requestedBy: string
	decidedBy: string | null
	decidedAt: string | null
	decisionReasonCode: ApprovalReasonCode | null
}

/**
 * The approval behind a document, in the one place both documents read it.
 *
 * It shows the fields the decision actually wrote — requester, decider, when, and the reason
 * code — and links to the inbox row, where `canDecide` and `canWithdraw` are the server's own
 * fields. A decision is never offered from this card.
 */
export function ApprovalSummaryCard({
	title,
	approval,
	branchName,
}: {
	title: string
	approval: ApprovalSummaryFields
	branchName: string | null
}) {
	const pending = approval.status === "PENDING"

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex flex-wrap items-center gap-2">
					{title}
					<StatusBadge variant={approvalStatusTone(approval.status)}>
						{approvalStatusLabel(approval.status)}
					</StatusBadge>
				</CardTitle>
				<CardDescription>
					{branchName ? `${branchName}. ` : ""}
					{pending ? "Awaiting a decision." : "Decision recorded."}
				</CardDescription>
			</CardHeader>
			<CardContent className="grid gap-3 text-sm">
				<dl className="grid gap-2">
					<div className="flex flex-wrap justify-between gap-2">
						<dt className="text-muted-foreground">Requested by</dt>
						<dd className="max-w-96 text-right font-mono text-xs">{approval.requestedBy}</dd>
					</div>
					<div className="flex flex-wrap justify-between gap-2">
						<dt className="text-muted-foreground">Decided by</dt>
						<dd className="max-w-96 text-right font-mono text-xs">
							{approval.decidedBy ?? "—"}
						</dd>
					</div>
					<div className="flex flex-wrap justify-between gap-2">
						<dt className="text-muted-foreground">Decided at</dt>
						<dd>{approval.decidedAt ? formatDateTime(approval.decidedAt) : "—"}</dd>
					</div>
					<div className="flex flex-wrap justify-between gap-2">
						<dt className="text-muted-foreground">Reason</dt>
						<dd>{approvalReasonLabel(approval.decisionReasonCode)}</dd>
					</div>
				</dl>
				<Link
					to="/approvals/$approvalId"
					params={{ approvalId: approval.id }}
					className="w-fit text-sm font-medium text-primary hover:underline"
				>
					Open the request
				</Link>
			</CardContent>
		</Card>
	)
}
