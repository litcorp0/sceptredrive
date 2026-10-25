import { useNavigate, useRouterState } from "@tanstack/react-router"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select"
import { useBranch } from "#/lib/branch-context"

/**
 * Branch scope for the console. Behaviour is unchanged: administrators switch
 * between branches (or all of them), managers are pinned to their own branch
 * and see it as a locked badge. Only the fascia styling differs.
 */
export function BranchSwitcher() {
	const { branches, activeBranchId, activeBranch, setActiveBranchId, canSelectBranch } = useBranch()
	const navigate = useNavigate()
	const pathname = useRouterState({ select: (state) => state.location.pathname })

	/**
	 * Keep the URL and the shell switcher in step on the two pages where branch is a search
	 * param (P9-D4). Anywhere else the switch only changes the provider, so a filter a user
	 * typed on a list page is not silently rewritten.
	 */
	function applyBranch(value: string) {
		const id = value === "all" ? null : value
		setActiveBranchId(id)
		if (pathname === "/analytics") {
			void navigate({
				to: "/analytics",
				search: (prev) => ({ ...prev, branchId: id ?? undefined }),
				replace: true,
			})
		} else if (pathname === "/") {
			void navigate({
				to: "/",
				search: (prev) => ({ ...prev, branchId: id ?? undefined }),
				replace: true,
			})
		}
	}

	if (!canSelectBranch) {
		return (
			<div className="flex h-8 max-w-36 items-center rounded-md border border-white/15 bg-white/5 px-2.5 text-sm text-topbar-foreground sm:max-w-none">
				<span className="truncate">
					{activeBranch ? `${activeBranch.code} · ${activeBranch.name}` : "No branch assigned"}
				</span>
			</div>
		)
	}

	return (
		<Select value={activeBranchId ?? "all"} onValueChange={applyBranch}>
			<SelectTrigger
				size="sm"
				className="w-32 border-topbar-muted/50 bg-transparent text-topbar-foreground hover:bg-white/10 focus-visible:border-topbar-muted/50 sm:w-52 [&_svg]:text-topbar-muted"
				aria-label="Active branch"
			>
				<SelectValue placeholder="All branches" />
			</SelectTrigger>
			<SelectContent>
				<SelectItem value="all">All branches</SelectItem>
				{branches.map((branch) => (
					<SelectItem key={branch.id} value={branch.id}>
						{branch.code} · {branch.name}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	)
}
