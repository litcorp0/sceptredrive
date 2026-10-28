import { formatDay } from "@sceptre/shared"
import { useQuery } from "@tanstack/react-query"
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router"
import { PlusIcon } from "lucide-react"
import { useState } from "react"
import { Pagination } from "#/components/common/pagination"
import { Button } from "#/components/ui/button"
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
import { useBranch } from "#/lib/branch-context"
import { branchLabelFor } from "#/lib/branch-label"
import { hasPermission } from "#/lib/role"
import { countListOptions } from "../api/counts"
import { CountStatusBadge } from "../components/count-status-badge"
import type { StockCountStatus } from "../types"

const authenticatedRoute = getRouteApi("/_authenticated")

const PAGE_SIZE = 25
const ALL = "all"

export function CountsPage() {
	const { session } = authenticatedRoute.useRouteContext()
	const { activeBranchId, branches } = useBranch()
	const navigate = useNavigate()
	const canCount = hasPermission(session.user.role, "inventory.count")

	const [status, setStatus] = useState<"all" | StockCountStatus>("all")
	const [offset, setOffset] = useState(0)

	const filters = {
		branchId: activeBranchId ?? undefined,
		status: status === ALL ? undefined : status,
		limit: PAGE_SIZE,
		offset,
	}

	const countsQuery = useQuery(countListOptions(filters))

	const rows = countsQuery.data?.counts ?? []
	const total = countsQuery.data?.total ?? 0

	return (
		<section>
			<div className="mb-3 flex flex-wrap items-end gap-3">
				<Select
					value={status}
					onValueChange={(value) => {
						setStatus(value as "all" | StockCountStatus)
						setOffset(0)
					}}
				>
					<SelectTrigger className="w-44" aria-label="Filter by status">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">All statuses</SelectItem>
						<SelectItem value="OPEN">Open</SelectItem>
						<SelectItem value="POSTED">Posted</SelectItem>
						<SelectItem value="CANCELLED">Cancelled</SelectItem>
					</SelectContent>
				</Select>

				{canCount ? (
					<Button
						size="sm"
						className="ml-auto"
						onClick={() => void navigate({ to: "/inventory/counts/new" })}
					>
						<PlusIcon className="size-4" aria-hidden="true" />
						New count
					</Button>
				) : null}
			</div>

			<div className="rounded-md border">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Number</TableHead>
							<TableHead>Branch</TableHead>
							<TableHead>Status</TableHead>
							<TableHead className="text-right">Lines</TableHead>
							<TableHead className="text-right">Counted</TableHead>
							<TableHead className="text-right">Variance units</TableHead>
							<TableHead>Created</TableHead>
							<TableHead className="w-16" />
						</TableRow>
					</TableHeader>
					<TableBody>
						{countsQuery.isLoading ? (
							<TableRow>
								<TableCell colSpan={8} className="text-muted-foreground">
									Loading counts…
								</TableCell>
							</TableRow>
						) : countsQuery.isError ? (
							<TableRow>
								<TableCell colSpan={8} className="text-destructive">
									Could not load counts.
								</TableCell>
							</TableRow>
						) : rows.length === 0 ? (
							<TableRow>
								<TableCell colSpan={8} className="text-muted-foreground">
									No stock counts yet. Open one to compare the shelf with the book.
								</TableCell>
							</TableRow>
						) : (
							rows.map((count) => (
								<TableRow key={count.id}>
									<TableCell className="font-mono text-xs">{count.number}</TableCell>
									<TableCell>
										{branchLabelFor(branches, {
											id: count.branchId,
											code: count.branchCode,
										})}
									</TableCell>
									<TableCell>
										<CountStatusBadge status={count.status} />
									</TableCell>
									<TableCell className="text-right tabular-nums">{count.lineCount}</TableCell>
									<TableCell className="text-right tabular-nums">{count.countedCount}</TableCell>
									<TableCell className="text-right tabular-nums">
										{count.varianceUnits > 0 ? "+" : ""}
										{count.varianceUnits}
									</TableCell>
									<TableCell className="whitespace-nowrap text-muted-foreground">
										{formatDay(count.createdAt)}
									</TableCell>
									<TableCell>
										<Link
											to="/inventory/counts/$countId"
											params={{ countId: count.id }}
											className="text-sm font-medium text-primary hover:underline"
										>
											View
										</Link>
									</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</div>

			{countsQuery.isSuccess ? (
				<Pagination total={total} limit={PAGE_SIZE} offset={offset} onOffsetChange={setOffset} />
			) : null}
		</section>
	)
}
