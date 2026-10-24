import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useState } from "react"
import { PageHeader } from "#/components/common/page-header"
import { LiabilityReport } from "#/components/customers/liability-report"
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"
import { ApiError } from "#/lib/api"
import { useBranch } from "#/lib/branch-context"
import { liabilityOptions } from "#/modules/loyalty"

export const Route = createFileRoute("/_authenticated/loyalty")({
	component: LoyaltyPage,
})

/**
 * Loyalty liability: the points outstanding across every branch, activity
 * totals per branch for a date range, and negative balances to review.
 */
function LoyaltyPage() {
	const { canSelectBranch } = useBranch()
	const [from, setFrom] = useState("")
	const [to, setTo] = useState("")

	const liabilityQuery = useQuery(liabilityOptions({ from, to }))

	const liabilityError =
		liabilityQuery.error instanceof ApiError
			? liabilityQuery.error.message
			: "Couldn't load the loyalty report."

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

			<div className="mb-4 flex flex-wrap items-end gap-3">
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
			</div>

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
