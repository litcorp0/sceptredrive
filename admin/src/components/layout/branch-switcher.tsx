import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select"
import { useBranch } from "#/lib/branch-context"

export function BranchSwitcher() {
	const { branches, activeBranchId, activeBranch, setActiveBranchId, canSelectBranch } = useBranch()

	if (!canSelectBranch) {
		return (
			<div className="flex h-8 items-center rounded-md border bg-muted/40 px-2.5 text-sm text-muted-foreground">
				{activeBranch ? `${activeBranch.code} · ${activeBranch.name}` : "No branch assigned"}
			</div>
		)
	}

	return (
		<Select
			value={activeBranchId ?? "all"}
			onValueChange={(value) => setActiveBranchId(value === "all" ? null : value)}
		>
			<SelectTrigger size="sm" className="w-52" aria-label="Active branch">
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
