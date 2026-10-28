import {
	EVAT_DOCUMENT_KINDS,
	EVAT_STATUS_LABELS,
	EVAT_SUBMISSION_STATUSES,
	type EvatDocumentKind,
	type EvatSubmissionStatus,
} from "@sceptre/shared"
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select"
import type { EvatSearch } from "../utils/search"

export const EVAT_KIND_LABELS: Record<EvatDocumentKind, string> = {
	INVOICE: "Invoice",
	REFUND: "Refund",
}

interface BranchOption {
	id: string
	name: string
}

/**
 * Status, kind, overdue, branch and period — the five filters the API accepts. Every change
 * resets paging, because page 3 of a different filter is not a view anybody asked for.
 */
export function EvatFilters({
	search,
	branches,
	canSelectBranch,
	activeBranchId,
	onChange,
}: {
	search: EvatSearch
	branches: BranchOption[]
	canSelectBranch: boolean
	activeBranchId: string | null
	onChange: (patch: Partial<EvatSearch>) => void
}) {
	return (
		<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
			<div className="grid gap-1.5">
				<Label htmlFor="evat-status-filter">Status</Label>
				<Select
					value={search.status ?? "ALL"}
					onValueChange={(value) =>
						onChange({
							status: value === "ALL" ? undefined : (value as EvatSubmissionStatus),
							offset: undefined,
						})
					}
				>
					<SelectTrigger id="evat-status-filter" className="w-full">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="ALL">All statuses</SelectItem>
						{EVAT_SUBMISSION_STATUSES.map((status) => (
							<SelectItem key={status} value={status}>
								{EVAT_STATUS_LABELS[status]}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			<div className="grid gap-1.5">
				<Label htmlFor="evat-kind-filter">Document</Label>
				<Select
					value={search.kind ?? "ALL"}
					onValueChange={(value) =>
						onChange({
							kind: value === "ALL" ? undefined : (value as EvatDocumentKind),
							offset: undefined,
						})
					}
				>
					<SelectTrigger id="evat-kind-filter" className="w-full">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="ALL">Invoices and refunds</SelectItem>
						{EVAT_DOCUMENT_KINDS.map((kind) => (
							<SelectItem key={kind} value={kind}>
								{EVAT_KIND_LABELS[kind]}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			<div className="grid gap-1.5">
				<Label htmlFor="evat-overdue-filter">Deadline</Label>
				<Select
					value={search.overdue ?? "ALL"}
					onValueChange={(value) =>
						onChange({
							overdue: value === "ALL" ? undefined : (value as "true" | "false"),
							offset: undefined,
						})
					}
				>
					<SelectTrigger id="evat-overdue-filter" className="w-full">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="ALL">Any deadline</SelectItem>
						<SelectItem value="true">Overdue only</SelectItem>
						<SelectItem value="false">On time only</SelectItem>
					</SelectContent>
				</Select>
			</div>

			{canSelectBranch ? (
				<div className="grid gap-1.5">
					<Label htmlFor="evat-branch-filter">Branch</Label>
					<Select
						value={search.branchId ?? (activeBranchId === null ? "ALL" : activeBranchId)}
						onValueChange={(value) =>
							onChange({ branchId: value === "ALL" ? "ALL" : value, offset: undefined })
						}
					>
						<SelectTrigger id="evat-branch-filter" className="w-full">
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
			) : null}

			<div className="grid gap-1.5">
				<Label htmlFor="evat-from-filter">Deadline in period</Label>
				<div className="flex items-center gap-1.5">
					<Input
						id="evat-from-filter"
						type="date"
						value={search.from ?? ""}
						onChange={(event) =>
							onChange({ from: event.target.value || undefined, offset: undefined })
						}
						aria-label="Deadline from"
					/>
					<Input
						type="date"
						value={search.to ?? ""}
						onChange={(event) =>
							onChange({ to: event.target.value || undefined, offset: undefined })
						}
						aria-label="Deadline to"
					/>
				</div>
			</div>
		</div>
	)
}
