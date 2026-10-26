import { formatDay } from "@sceptre/shared"
import { useQuery } from "@tanstack/react-query"
import { getRouteApi, Link } from "@tanstack/react-router"
import { ClipboardList } from "lucide-react"
import { EmptyState } from "#/components/common/empty-state"
import { PageHeader } from "#/components/common/page-header"
import { Pagination } from "#/components/common/pagination"
import { StatusBadge } from "#/components/common/status-badge"
import { TableMessage } from "#/components/common/table-message"
import { Label } from "#/components/ui/label"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table"
import { ApiError } from "#/lib/api"
import { useBranch } from "#/lib/branch-context"
import { formatGhs } from "#/lib/format"
import { writeOffListOptions } from "../api/writeoffs"
import type { WriteOffStatus } from "../types"
import {
	type WriteOffSearch,
	WRITE_OFF_STATUSES,
	WRITE_OFF_STATUS_LABELS,
	writeOffStatusLabel,
	writeOffStatusTone,
} from "../utils/writeoff"

const routeApi = getRouteApi("/_authenticated/inventory/write-offs")
const PAGE_SIZE = 25
const ALL = "all"

/**
 * The branch's write-off documents.
 *
 * This is the list Plan 12's create form and detail screen extend; for now it answers the
 * operations page's "awaiting decision" count and opens the approval that decides it. Filters and
 * paging are in the URL so the operations card can link to the exact queue it counted.
 */
export function WriteOffsPage() {
	const search = routeApi.useSearch()
	const navigate = routeApi.useNavigate()
	const { branches, canSelectBranch } = useBranch()
	const offset = search.offset ?? 0

	const query = {
		branchId: search.branchId,
		status: search.status,
		limit: PAGE_SIZE,
		offset,
	}

	const writeOffsQuery = useQuery(writeOffListOptions(query))
	const denied = writeOffsQuery.error instanceof ApiError && writeOffsQuery.error.status === 403
	const rows = writeOffsQuery.data?.writeOffs ?? []
	const total = writeOffsQuery.data?.total ?? 0

	function patch(next: Partial<WriteOffSearch>) {
		void navigate({ search: (prev: WriteOffSearch) => ({ ...prev, ...next }) })
	}

	return (
		<div className="grid gap-4">
			<PageHeader
				eyebrow="Inventory"
				title="Write-offs"
				description="Goods that left the shelf without a sale. A write-off is raised complete, decided as one document, and posted only when approved."
			/>

			{denied ? (
				<EmptyState
					icon={ClipboardList}
					title="You cannot see write-offs"
					description="Your role does not include inventory.read. Ask an administrator if you should be able to review this branch's documents."
				/>
			) : (
				<>
					<div className="flex flex-wrap items-end gap-3">
						<div className="grid gap-1.5">
							<Label htmlFor="write-off-status" className="text-xs text-muted-foreground">
								Status
							</Label>
							<Select
								value={search.status ?? ALL}
								onValueChange={(value) =>
									patch({
										status: value === ALL ? undefined : (value as WriteOffStatus),
										offset: undefined,
									})
								}
							>
								<SelectTrigger id="write-off-status" className="w-52">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value={ALL}>All statuses</SelectItem>
									{WRITE_OFF_STATUSES.map((status) => (
										<SelectItem key={status} value={status}>
											{WRITE_OFF_STATUS_LABELS[status]}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						{canSelectBranch ? (
							<div className="grid gap-1.5">
								<Label htmlFor="write-off-branch" className="text-xs text-muted-foreground">
									Branch
								</Label>
								<Select
									value={search.branchId ?? ALL}
									onValueChange={(value) =>
										patch({
											branchId: value === ALL ? undefined : value,
											offset: undefined,
										})
									}
								>
									<SelectTrigger id="write-off-branch" className="w-52">
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

					<div className="min-w-0 rounded-md border">
						<Table className="min-w-[52rem]">
							<TableHeader>
								<TableRow>
									<TableHead>Number</TableHead>
									<TableHead>Branch</TableHead>
									<TableHead>Status</TableHead>
									<TableHead className="text-right">Lines</TableHead>
									<TableHead className="text-right">Frozen value</TableHead>
									<TableHead>Requested by</TableHead>
									<TableHead>Raised</TableHead>
									<TableHead className="w-20" />
								</TableRow>
							</TableHeader>
							<TableBody>
								{writeOffsQuery.isLoading ? (
									<TableMessage colSpan={8} state="loading" rows={5}>
										Loading write-offs…
									</TableMessage>
								) : writeOffsQuery.isError ? (
									<TableMessage colSpan={8} state="error">
										Couldn't load write-offs.
									</TableMessage>
								) : rows.length === 0 ? (
									<TableMessage colSpan={8} state="empty">
										No write-offs match these filters.
									</TableMessage>
								) : (
									rows.map((row) => (
										<TableRow key={row.id}>
											<TableCell className="font-mono text-xs">{row.number}</TableCell>
											<TableCell className="whitespace-nowrap text-muted-foreground">
												{row.branchName}
											</TableCell>
											<TableCell>
												<StatusBadge variant={writeOffStatusTone(row.status)}>
													{writeOffStatusLabel(row.status)}
												</StatusBadge>
											</TableCell>
											<TableCell className="text-right tabular-nums">{row.lineCount}</TableCell>
											<TableCell className="text-right tabular-nums">
												{formatGhs(row.valueMinor)}
											</TableCell>
											<TableCell className="whitespace-nowrap text-muted-foreground">
												{row.requestedBy}
											</TableCell>
											<TableCell className="whitespace-nowrap text-muted-foreground">
												{formatDay(row.createdAt)}
											</TableCell>
											<TableCell>
												{row.approvalId ? (
													<Link
														to="/approvals/$approvalId"
														params={{ approvalId: row.approvalId }}
														className="text-sm font-medium text-primary hover:underline"
														aria-label={`Review write-off ${row.number}`}
													>
														Review
													</Link>
												) : null}
											</TableCell>
										</TableRow>
									))
								)}
							</TableBody>
						</Table>
					</div>

					{writeOffsQuery.isSuccess ? (
						<Pagination
							total={total}
							limit={PAGE_SIZE}
							offset={offset}
							onOffsetChange={(next) => patch({ offset: next === 0 ? undefined : next })}
						/>
					) : null}
				</>
			)}
		</div>
	)
}
