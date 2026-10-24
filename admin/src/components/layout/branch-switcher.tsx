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
		<Select
			value={activeBranchId ?? "all"}
			onValueChange={(value) => setActiveBranchId(value === "all" ? null : value)}
		>
			<SelectTrigger
				size="sm"
				className="w-32 border-topbar-muted/50 bg-transparent text-topbar-foreground hover:bg-white/10 sm:w-52 [&_svg]:text-topbar-muted"
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
