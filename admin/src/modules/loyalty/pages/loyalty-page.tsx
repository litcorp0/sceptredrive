import { formatDateTime, formatDay, formatRange } from "@sceptre/shared"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { ExportButton } from "#/components/common/export-button"
import { PageHeader } from "#/components/common/page-header"
import { PrintButton } from "#/components/common/print-button"
import { PrintSheet } from "#/components/common/print-sheet"
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"
import { ApiError } from "#/lib/api"
import { useBranch } from "#/lib/branch-context"
import { liabilityOptions } from "../api/loyalty"
import { LiabilityReport } from "../components/liability-report"

/**
 * Loyalty liability: the points outstanding across every branch, activity
 * totals per branch for a date range, and negative balances to review.
 *
 * `branchId` scopes the activity rows and the negative balances; the outstanding
 * points are a global projection read **as of now** (P14-D21). The report says so
 * on screen and on paper, because a liability figure without its instant is a rumour.
 */
export function LoyaltyPage() {
	const { canSelectBranch, activeBranchId, branches } = useBranch()
	const [from, setFrom] = useState("")
	const [to, setTo] = useState("")

	const liabilityQuery = useQuery(
		liabilityOptions({ branchId: activeBranchId ?? undefined, from, to }),
	)
	const report = liabilityQuery.data

	const liabilityError =
		liabilityQuery.error instanceof ApiError
			? liabilityQuery.error.message
			: "Couldn't load the loyalty report."

	const activityBranch = report?.activity.branchId
		? (branches.find((branch) => branch.id === report.activity.branchId)?.name ??
			report.activity.branchId)
		: "All branches"

	// The activity section is the only part a period filters; the balance has no history here.
	const activityPeriod = report?.activity.from
		? report.activity.to
			? formatRange(report.activity.from, report.activity.to)
			: `From ${formatDay(report.activity.from)}`
		: report?.activity.to
			? `Up to ${formatDay(report.activity.to)}`
			: "Every entry on record"

	return (
		<div className="mx-auto max-w-6xl">
			<PageHeader
				title="Loyalty"
				description={
					canSelectBranch
						? "Outstanding points and their redemption value, activity per branch, and balances below zero."
						: "Your branch activity, the global points balance, and balances below zero."
				}
			/>

			<div className="mb-4 flex flex-wrap items-end gap-3 print:hidden">
				<div className="grid gap-1.5">
					<Label htmlFor="liability-from" className="text-xs text-muted-foreground">
						From
					</Label>
					<Input
						id="liability-from"
						type="date"
						className="w-40"
						value={from}
						onChange={(event) => setFrom(event.target.value)}
					/>
				</div>
				<div className="grid gap-1.5">
					<Label htmlFor="liability-to" className="text-xs text-muted-foreground">
						To
					</Label>
					<Input
						id="liability-to"
						type="date"
						className="w-40"
						value={to}
						onChange={(event) => setTo(event.target.value)}
					/>
				</div>

				<div className="ml-auto flex gap-2">
					<ExportButton
						path="/api/loyalty/liability/export"
						query={{
							branchId: activeBranchId ?? undefined,
							from: from || undefined,
							to: to || undefined,
						}}
						label="Loyalty liability"
						disabled={!report}
						title="Points and values; values are in pesewas"
					/>
					<PrintButton label="loyalty liability" disabled={!report} />
				</div>
			</div>

			<PrintSheet
				title="Loyalty liability"
				meta={[
					{ label: "Branch (activity)", value: activityBranch },
					{ label: "Activity period", value: activityPeriod },
					{
						label: "Liability as at",
						value: report ? `${formatDateTime(report.asOf)} (as of now)` : "—",
					},
				]}
			/>
			{liabilityQuery.isLoading ? (
				<p className="text-sm text-muted-foreground">Loading loyalty report…</p>
			) : liabilityQuery.isError ? (
				<p className="text-sm text-destructive">{liabilityError}</p>
			) : liabilityQuery.data ? (
				<LiabilityReport report={liabilityQuery.data} />
			) : null}
		</div>
	)
}
