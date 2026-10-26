import { formatDay } from "@sceptre/shared"
import { useQuery } from "@tanstack/react-query"
import { getRouteApi, Link } from "@tanstack/react-router"
import { ClipboardList, PlusIcon } from "lucide-react"
import { useState } from "react"
import { EmptyState } from "#/components/common/empty-state"
import { PageHeader } from "#/components/common/page-header"
import { Pagination } from "#/components/common/pagination"
import { StatusBadge } from "#/components/common/status-badge"
import { StatusNote } from "#/components/common/status-note"
import { TableMessage } from "#/components/common/table-message"
import { Button } from "#/components/ui/button"
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
import { hasPermission } from "#/lib/role"
import { writeOffListOptions } from "../api/writeoffs"
import { AdjustDialog } from "../components/adjust-dialog"
import type { WriteOffStatus } from "../types"
import {
	type WriteOffSearch,
	WRITE_OFF_STATUSES,
	WRITE_OFF_STATUS_LABELS,
	writeOffStatusLabel,
	writeOffStatusTone,
} from "../utils/writeoff"

const routeApi = getRouteApi("/_authenticated/inventory/write-offs/")
const authenticatedRoute = getRouteApi("/_authenticated")
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
	const { session } = authenticatedRoute.useRouteContext()
	const search = routeApi.useSearch()
	const navigate = routeApi.useNavigate()
	const { branches, canSelectBranch, activeBranch, activeBranchId } = useBranch()
	const offset = search.offset ?? 0

	const isAdmin = session.user.role === "ADMIN"
	const canAdjust = hasPermission(session.user.role, "inventory.adjust")
	const [adjustOpen, setAdjustOpen] = useState(false)

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
					{isAdmin ? (
						<StatusNote tone="info" title="Administrators adjust directly">
							A write-off request is for branch managers. You post a negative adjustment with a
							reason code, and the ledger records it immediately.
						</StatusNote>
					) : null}

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

						{canAdjust ? (
							isAdmin ? (
								<div className="ml-auto flex flex-wrap items-center gap-2">
									{!activeBranchId ? (
										<span className="text-xs text-muted-foreground">
											Choose a branch to adjust stock.
										</span>
									) : null}
									<Button disabled={!activeBranchId} onClick={() => setAdjustOpen(true)}>
										Adjust stock
									</Button>
								</div>
							) : (
								<Button size="sm" className="ml-auto" asChild>
									<Link to="/inventory/write-offs/new">
										<PlusIcon className="size-4" aria-hidden="true" />
										New write-off
									</Link>
								</Button>
							)
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
									<TableHead className="w-32" />
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
												<div className="flex items-center gap-3">
													<Link
														to="/inventory/write-offs/$writeOffId"
														params={{ writeOffId: row.id }}
														className="text-sm font-medium text-primary hover:underline"
														aria-label={`View write-off ${row.number}`}
													>
														View
													</Link>
													{row.approvalId ? (
														<Link
															to="/approvals/$approvalId"
															params={{ approvalId: row.approvalId }}
															className="text-sm text-muted-foreground hover:underline"
															aria-label={`Review write-off ${row.number}`}
														>
															Review
														</Link>
													) : null}
												</div>
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

			<AdjustDialog
				open={adjustOpen}
				onOpenChange={setAdjustOpen}
				branchId={activeBranchId}
				branchName={activeBranch?.name ?? null}
			/>
		</div>
	)
}
