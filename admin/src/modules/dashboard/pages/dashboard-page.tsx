import { useQuery } from "@tanstack/react-query"
import { getRouteApi } from "@tanstack/react-router"
import { useBranch } from "#/lib/branch-context"
import { staffListOptions } from "#/modules/staff"
import { terminalListOptions } from "#/modules/terminals"
import { RecentActivity } from "../components/recent-activity"
import { StatCard } from "../components/stat-card"

const authenticatedRoute = getRouteApi("/_authenticated")

/**
 * The signed-in landing page. A placeholder summary today: three counts and the audit feed.
 *
 * TODO(phase-9): replaced wholesale by the executive dashboard — sales, transactions, average
 * basket, tax, low stock, credit, payables, loyalty and sync health, all from server aggregates.
 */
export function DashboardPage() {
	const { session } = authenticatedRoute.useRouteContext()
	const { branches, activeBranchId, activeBranch, canSelectBranch } = useBranch()

	const terminalsQuery = useQuery(terminalListOptions({ branchId: activeBranchId ?? undefined }))

	// The key was `['staff', { scope: 'dashboard' }]` before Phase 8; the root is unchanged, so a
	// staff mutation still invalidates this card through the `['staff']` prefix.
	const staffQuery = useQuery(staffListOptions({ limit: 1 }))

	const scopeLabel = canSelectBranch
		? activeBranch
			? `${activeBranch.code} · ${activeBranch.name}`
			: "All branches"
		: (activeBranch?.name ?? "Your branch")

	return (
		<div className="grid gap-6">
			<div>
				<h1 className="text-xl font-semibold tracking-tight">Welcome back, {session.user.name}</h1>
				<p className="mt-1 text-sm text-muted-foreground">
					Signed in as {session.user.staffId ?? session.user.email} · {session.user.role} ·{" "}
					{scopeLabel}
				</p>
			</div>

			<div className="grid gap-4 sm:grid-cols-3">
				<StatCard
					label={canSelectBranch ? "Branches" : "Branch"}
					value={canSelectBranch ? String(branches.length) : (activeBranch?.code ?? "—")}
					detail={canSelectBranch ? "Active locations" : (activeBranch?.name ?? "Not assigned")}
				/>
				<StatCard
					label="Terminals"
					value={
						terminalsQuery.isLoading ? "…" : String(terminalsQuery.data?.terminals.length ?? 0)
					}
					detail={activeBranchId ? "In this branch" : "Across all branches"}
				/>
				<StatCard
					label="Staff"
					value={staffQuery.isLoading ? "…" : String(staffQuery.data?.total ?? 0)}
					detail="Accounts you can see"
				/>
			</div>

			<RecentActivity />
		</div>
	)
}
