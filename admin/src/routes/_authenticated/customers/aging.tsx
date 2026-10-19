import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useState } from "react"
import { AgingTable } from "#/components/customers/aging-table"
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select"
import { ApiError, api } from "#/lib/api"
import { useBranch } from "#/lib/branch-context"
import { formatDay } from "#/lib/format"

export const Route = createFileRoute("/_authenticated/customers/aging")({
	component: AgingTab,
})

/**
 * Credit aging: fixed buckets from each charge's due date, as of one day.
 * Managers see their branch; admins pick a branch or all of them.
 */
function AgingTab() {
	const { session } = Route.useRouteContext()
	const { branches, activeBranchId, canSelectBranch } = useBranch()

	// undefined follows the header branch switcher; null means all branches.
	const [branchChoice, setBranchChoice] = useState<string | null | undefined>(undefined)
	const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10))

	const effectiveBranchId = canSelectBranch
		? branchChoice === undefined
			? activeBranchId
			: branchChoice
		: (session.user.branchId ?? null)
	const selectedBranch = branches.find((branch) => branch.id === effectiveBranchId) ?? null

	const agingQuery = useQuery({
		queryKey: ["aging", effectiveBranchId, asOf],
		queryFn: () =>
			api.credit.aging({ branchId: effectiveBranchId ?? undefined, asOf: asOf || undefined }),
	})

	const agingError =
		agingQuery.error instanceof ApiError
			? agingQuery.error.message
			: "Couldn't load the aging report."

	return (
		<div className="grid gap-4">
			<div className="flex flex-wrap items-end gap-3 print:hidden">
				{canSelectBranch ? (
					<div className="grid gap-1.5">
						<Label htmlFor="aging-branch" className="text-xs text-muted-foreground">
							Branch
						</Label>
						<Select
							value={effectiveBranchId ?? "ALL"}
							onValueChange={(value) => setBranchChoice(value === "ALL" ? null : value)}
						>
							<SelectTrigger id="aging-branch" className="w-52">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="ALL">All branches</SelectItem>
								{branches.map((branch) => (
									<SelectItem key={branch.id} value={branch.id}>
										{branch.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				) : (
					<p className="self-center text-sm text-muted-foreground">
						Branch:{" "}
						<span className="font-medium text-foreground">{selectedBranch?.name ?? "—"}</span>
					</p>
				)}

				<div className="grid gap-1.5">
					<Label htmlFor="aging-asof" className="text-xs text-muted-foreground">
						Aging as of
					</Label>
					<Input
						id="aging-asof"
						type="date"
						className="w-40"
						value={asOf}
						onChange={(event) => setAsOf(event.target.value)}
					/>
				</div>
			</div>

			<div className="hidden print:block">
				<p className="text-lg font-semibold">
					Credit aging — as of {formatDay(agingQuery.data?.asOf ?? asOf)}
				</p>
			</div>

			{agingQuery.isLoading ? (
				<p className="text-sm text-muted-foreground">Loading aging report…</p>
			) : agingQuery.isError ? (
				<p className="text-sm text-destructive">{agingError}</p>
			) : agingQuery.data ? (
				<div className="grid gap-4">
					{agingQuery.data.branches.map((branch) => (
						<AgingTable key={branch.branch.id} branch={branch} asOf={agingQuery.data.asOf} />
					))}
				</div>
			) : null}
		</div>
	)
}
