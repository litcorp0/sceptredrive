import { APPROVAL_STATUSES, APPROVAL_TYPES, type ApprovalType } from "@sceptre/shared"
import { Label } from "#/components/ui/label"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select"
import { useBranch } from "#/lib/branch-context"
import type { ApprovalSearch } from "../utils/approval"
import { APPROVAL_STATUS_LABELS, APPROVAL_TYPE_LABELS } from "../utils/approval"

const ALL = "all"

interface ApprovalFiltersProps {
	search: ApprovalSearch
	/** Writes a patch to the URL; the page owns navigation and offset resets. */
	onChange: (patch: Partial<ApprovalSearch>) => void
}

/**
 * The inbox filters, all in the URL.
 *
 * Type, status and sort apply to every caller; the branch filter is an admin's, because a
 * manager's scope is decided by the server and a control that appeared to widen it would be a
 * lie. Changing any filter resets the page: page three of a different filter is meaningless.
 */
export function ApprovalFilters({ search, onChange }: ApprovalFiltersProps) {
	const { branches, canSelectBranch, activeBranchId } = useBranch()
	const branchValue = search.branchId ?? activeBranchId ?? ALL

	return (
		<div className="flex flex-wrap items-end gap-3">
			<div className="grid gap-1.5">
				<Label htmlFor="approval-type" className="text-xs text-muted-foreground">
					Type
				</Label>
				<Select
					value={search.type ?? ALL}
					onValueChange={(value) =>
						onChange({
							type: value === ALL ? undefined : (value as ApprovalType),
							offset: undefined,
						})
					}
				>
					<SelectTrigger id="approval-type" className="w-52">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value={ALL}>All types</SelectItem>
						{APPROVAL_TYPES.map((type) => (
							<SelectItem key={type} value={type}>
								{APPROVAL_TYPE_LABELS[type]}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			<div className="grid gap-1.5">
				<Label htmlFor="approval-status" className="text-xs text-muted-foreground">
					Status
				</Label>
				<Select
					value={search.status ?? "PENDING"}
					onValueChange={(value) =>
						onChange({
							status: value as ApprovalSearch["status"],
							offset: undefined,
						})
					}
				>
					<SelectTrigger id="approval-status" className="w-44">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="ALL">All statuses</SelectItem>
						{APPROVAL_STATUSES.map((status) => (
							<SelectItem key={status} value={status}>
								{APPROVAL_STATUS_LABELS[status]}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			<div className="grid gap-1.5">
				<Label htmlFor="approval-sort" className="text-xs text-muted-foreground">
					Order
				</Label>
				<Select
					value={search.sort ?? "oldest"}
					onValueChange={(value) =>
						onChange({ sort: value as ApprovalSearch["sort"], offset: undefined })
					}
				>
					<SelectTrigger id="approval-sort" className="w-40">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="oldest">Oldest first</SelectItem>
						<SelectItem value="newest">Newest first</SelectItem>
					</SelectContent>
				</Select>
			</div>

			{canSelectBranch ? (
				<div className="grid gap-1.5">
					<Label htmlFor="approval-branch" className="text-xs text-muted-foreground">
						Branch
					</Label>
					<Select
						value={branchValue}
						onValueChange={(value) =>
							onChange({
								branchId: value as ApprovalSearch["branchId"],
								offset: undefined,
							})
						}
					>
						<SelectTrigger id="approval-branch" className="w-52">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value={ALL}>All branches</SelectItem>
							{branches.map((branch) => (
								<SelectItem key={branch.id} value={branch.id}>
									{branch.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			) : null}
		</div>
	)
}
