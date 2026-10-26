import { APPROVAL_TYPES, formatBasisPoints, formatCount, formatRelative } from "@sceptre/shared"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { CheckCircle2, ShieldAlert } from "lucide-react"
import { EmptyState } from "#/components/common/empty-state"
import { PageHeader } from "#/components/common/page-header"
import { Button } from "#/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card"
import { Skeleton } from "#/components/ui/skeleton"
import { ApiError } from "#/lib/api"
import { useBranch } from "#/lib/branch-context"
import { typeLabel } from "#/modules/approvals"
import { operationsSummaryOptions } from "../api/operations"
import { QueueCard } from "../components/queue-card"
import { queueLink } from "../utils/queue"

/**
 * The manager's branch view: what needs them today, as counts that open the list behind each one.
 *
 * Sections the API does not send are rendered as nothing at all — absence means "you may not
 * know", not "nothing is waiting" (P12-D37). A zero count is shown, because zero is a statement
 * about the branch and a manager should be able to see that the queue is clear.
 */
export function OperationsPage() {
	const { activeBranch, activeBranchId, canSelectBranch } = useBranch()
	const summaryQuery = useQuery(operationsSummaryOptions(activeBranchId))

	const summary = summaryQuery.data
	const denied = summaryQuery.error instanceof ApiError && summaryQuery.error.status === 403
	const branchLabel = canSelectBranch
		? activeBranch
			? activeBranch.name
			: "All branches"
		: (activeBranch?.name ?? "Your branch")

	const approvals = summary?.approvals
	const approvalBreakdown = approvals
		? APPROVAL_TYPES.filter((type) => approvals.byType[type] > 0)
				.map((type) => `${formatCount(approvals.byType[type])} ${typeLabel(type).toLowerCase()}`)
				.join(" · ") || "No request type is waiting"
		: ""

	const present = summary
		? [
				summary.approvals,
				summary.transferRequests,
				summary.writeOffs,
				summary.shiftVariances,
				summary.lowStock,
				summary.overLimitCredit,
			].filter((queue) => queue !== undefined)
		: []
	const nothingWaiting = present.length > 0 && present.every((queue) => queue.count === 0)

	return (
		<div className="grid gap-4">
			<PageHeader
				eyebrow="Operations"
				title="Branch operations"
				description={`What needs a decision or a look today, scoped to ${branchLabel}. Every count opens the filtered list it counts.`}
				actions={
					<Button variant="outline" size="sm" asChild>
						<Link to="/approvals">Open the inbox</Link>
					</Button>
				}
			/>

			{summaryQuery.isLoading ? (
				<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
					<output className="sr-only">Loading branch operations</output>
					{Array.from({ length: 6 }, (_, index) => `queue-${index}`).map((key) => (
						<Skeleton key={key} className="h-32 w-full" />
					))}
				</div>
			) : denied ? (
				<EmptyState
					icon={ShieldAlert}
					title="You cannot see branch operations"
					description="This view is for managers and administrators with approval.read. Ask an administrator if you need access."
				/>
			) : summaryQuery.isError || !summary ? (
				<div className="rounded-lg border border-dashed p-4">
					<p className="text-sm text-destructive">Couldn't load branch operations.</p>
					<p className="mt-1 text-xs text-muted-foreground">
						The server did not answer. Try again in a moment.
					</p>
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="mt-3"
						onClick={() => void summaryQuery.refetch()}
					>
						Retry
					</Button>
				</div>
			) : (
				<>
					<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
						{summary.approvals ? (
							<QueueCard
								link={queueLink("approvals", summary.branchId)}
								label="Pending approvals"
								count={summary.approvals.count}
								detail={
									<>
										{summary.approvals.oldest ? (
											<span className="block">
												Oldest: {typeLabel(summary.approvals.oldest.type)} ·{" "}
												{formatRelative(summary.approvals.oldest.requestedAt)}
											</span>
										) : null}
										<span className="block">{approvalBreakdown}</span>
									</>
								}
							/>
						) : null}

						{summary.transferRequests ? (
							<QueueCard
								link={queueLink("transferRequests", summary.branchId)}
								label="Transfer requests"
								count={summary.transferRequests.count}
								detail="Requests waiting at the source branch before dispatch."
							/>
						) : null}

						{summary.writeOffs ? (
							<QueueCard
								link={queueLink("writeOffs", summary.branchId)}
								label="Write-offs awaiting decision"
								count={summary.writeOffs.count}
								detail="Documents whose value is already frozen; approving posts the movements."
							/>
						) : null}

						{summary.shiftVariances ? (
							<QueueCard
								link={queueLink("shiftVariances", summary.branchId)}
								label="Shift variances awaiting review"
								count={summary.shiftVariances.count}
								detail="Closed shifts whose drawer differs from the server's expectation."
							/>
						) : null}

						{summary.lowStock ? (
							<QueueCard
								link={queueLink("lowStock", summary.branchId)}
								label="Products at or below threshold"
								count={summary.lowStock.count}
								detail="Stock lines that need a transfer or a purchase order."
							/>
						) : null}

						{summary.overLimitCredit ? (
							<QueueCard
								link={queueLink("overLimitCredit", summary.branchId)}
								label="Customers over their limit"
								count={summary.overLimitCredit.count}
								detail="Balances already above the approved limit."
							/>
						) : null}

						{summary.countAccuracyBp !== undefined ? (
							<Card>
								<CardHeader>
									<CardDescription>Count accuracy</CardDescription>
									<CardTitle className="font-display text-2xl tabular-nums">
										{formatBasisPoints(summary.countAccuracyBp)}
									</CardTitle>
								</CardHeader>
								<CardContent className="pt-0">
									<p className="text-xs text-muted-foreground">
										Share of counted lines that matched, on posted counts this month. A line matches
										when the counted quantity equals the snapshot it was counted against.
									</p>
								</CardContent>
							</Card>
						) : null}
					</div>

					{nothingWaiting ? (
						<EmptyState
							icon={CheckCircle2}
							title="Nothing needs you today"
							description="The queues are clear. Take a payment at the till and this page will show anything that needs a decision as it arises."
						/>
					) : null}
				</>
			)}
		</div>
	)
}
