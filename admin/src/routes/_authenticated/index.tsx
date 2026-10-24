import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { RecentActivity } from "#/components/common/recent-activity"
import { api } from "#/lib/api"
import { useBranch } from "#/lib/branch-context"

export const Route = createFileRoute("/_authenticated/")({
	component: DashboardPage,
})

function DashboardPage() {
	const { session } = Route.useRouteContext()
	const { branches, activeBranchId, activeBranch, canSelectBranch } = useBranch()

	const terminalsQuery = useQuery({
		queryKey: ["terminals", { branchId: activeBranchId ?? undefined }],
		queryFn: () => api.terminals.list(activeBranchId ? { branchId: activeBranchId } : {}),
	})

	const staffQuery = useQuery({
		queryKey: ["staff", { scope: "dashboard" }],
		queryFn: () => api.staff.list({ limit: 1 }),
	})

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

function StatCard({ label, value, detail }: { label: string; value: string; detail: string }) {
	return (
		<div className="rounded-lg border bg-card p-4">
			<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
			<p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
			<p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
		</div>
	)
}
