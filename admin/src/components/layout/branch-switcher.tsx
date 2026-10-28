import { formatBranchLabel } from "@sceptre/shared"
import { useNavigate, useRouterState, useSearch } from "@tanstack/react-router"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select"
import { useBranch } from "#/lib/branch-context"

/**
 * The search fields the shell may rewrite. The router-wide search now includes `/pos`'s
 * `tab` vocabulary as well, so a reducer that spreads `prev` produces a wider type than
 * `/analytics` accepts. This is the analytics shape, named once.
 */
type BranchSearchWrite = {
	tab?: "sales" | "products" | "inventory" | "credit" | "loyalty" | "payables" | "tax"
	from?: string
	to?: string
	granularity?: "day" | "week" | "month"
	branchId?: string
	sort?: string
	direction?: "asc" | "desc"
	offset?: number
}

/**
 * Branch scope for the console. Behaviour is unchanged: administrators switch
 * between branches (or all of them), managers are pinned to their own branch
 * and see it as a locked badge. Only the fascia styling differs.
 */
export function BranchSwitcher() {
	const { branches, activeBranchId, activeBranch, setActiveBranchId, canSelectBranch } = useBranch()
	const navigate = useNavigate()
	const pathname = useRouterState({ select: (state) => state.location.pathname })
	const search = useSearch({ strict: false }) as BranchSearchWrite

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
				search: { ...search, branchId: id ?? undefined },
				replace: true,
			})
		} else if (pathname === "/") {
			void navigate({
				to: "/",
				search: { ...search, branchId: id ?? undefined },
				replace: true,
			})
		}
	}

	if (!canSelectBranch) {
		return (
			<div className="flex h-8 max-w-36 items-center rounded-md border border-white/15 bg-white/5 px-2.5 text-sm text-topbar-foreground sm:max-w-none">
				<span className="truncate">
					{activeBranch ? formatBranchLabel(activeBranch) : "No branch assigned"}
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
						{formatBranchLabel(branch)}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	)
}
