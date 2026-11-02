import { formatDay } from "@sceptre/shared"
import { useQuery } from "@tanstack/react-query"
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router"
import { PlusIcon } from "lucide-react"
import { useState } from "react"
import { Pagination } from "#/components/common/pagination"
import { StatusBadge } from "#/components/common/status-badge"
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
import { formatGhs } from "#/lib/format"
import { hasPermission } from "#/lib/role"
import { openingListOptions } from "../api/openings"
import type { OpeningStatus } from "../types"

const authenticatedRoute = getRouteApi("/_authenticated")
const PAGE_SIZE = 25
const ALL = "all"

export function OpeningsPage() {
	const { session } = authenticatedRoute.useRouteContext()
	const { activeBranchId, branches } = useBranch()
	const navigate = useNavigate()
	const canDraft = hasPermission(session.user.role, "inventory.opening.draft")

	const [status, setStatus] = useState<"all" | OpeningStatus>("all")
	const [offset, setOffset] = useState(0)

	const query = {
		branchId: activeBranchId ?? undefined,
		status: status === ALL ? undefined : status,
		limit: PAGE_SIZE,
		offset,
	}
	const openingsQuery = useQuery(openingListOptions(query))
	const rows = openingsQuery.data?.openings ?? []
	const total = openingsQuery.data?.total ?? 0

	return (
		<section>
			<div className="mb-3 flex flex-wrap items-end gap-3">
				<Select
					value={status}
					onValueChange={(value) => {
						setStatus(value as "all" | OpeningStatus)
						setOffset(0)
					}}
				>
					<SelectTrigger className="w-44" aria-label="Filter by status">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">All statuses</SelectItem>
						<SelectItem value="DRAFT">Draft</SelectItem>
						<SelectItem value="POSTED">Posted</SelectItem>
					</SelectContent>
				</Select>

				{canDraft ? (
					<Button
						size="sm"
						className="ml-auto"
						onClick={() => void navigate({ to: "/inventory/openings/new" })}
					>
						<PlusIcon className="size-4" aria-hidden="true" />
						New opening
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
							<TableHead>Counted</TableHead>
							<TableHead className="text-right">Lines</TableHead>
							<TableHead className="text-right">Units</TableHead>
							<TableHead className="text-right">Counted value</TableHead>
							<TableHead className="text-right">New products</TableHead>
							<TableHead className="w-16" />
						</TableRow>
					</TableHeader>
					<TableBody>
						{openingsQuery.isLoading ? (
							<TableRow>
								<TableCell colSpan={9} className="text-muted-foreground">
									Loading opening stock…
								</TableCell>
							</TableRow>
						) : openingsQuery.isError ? (
							<TableRow>
								<TableCell colSpan={9} className="text-destructive">
									Could not load opening stock.
								</TableCell>
							</TableRow>
						) : rows.length === 0 ? (
							<TableRow>
								<TableCell colSpan={9} className="text-muted-foreground">
									No opening stock yet. Start one to bring the shelf onto the ledger.
								</TableCell>
							</TableRow>
						) : (
							rows.map((opening) => (
								<TableRow key={opening.id}>
									<TableCell className="font-mono text-xs">{opening.number}</TableCell>
									<TableCell>
										{branchLabelFor(branches, {
											id: opening.branchId,
											code: opening.branchCode,
										})}
									</TableCell>
									<TableCell>
										<StatusBadge variant={opening.status === "POSTED" ? "ok" : "warn"}>
											{opening.status === "POSTED" ? "Posted" : "Draft"}
										</StatusBadge>
									</TableCell>
									<TableCell className="whitespace-nowrap text-muted-foreground">
										{formatDay(opening.countedAt)}
									</TableCell>
									<TableCell className="text-right tabular-nums">{opening.lineCount}</TableCell>
									<TableCell className="text-right tabular-nums">{opening.totalUnits}</TableCell>
									<TableCell className="text-right tabular-nums">
										{formatGhs(opening.countedValueMinor)}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{opening.newProductCount}
									</TableCell>
									<TableCell>
										<Link
											to="/inventory/openings/$openingId"
											params={{ openingId: opening.id }}
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

			{openingsQuery.isSuccess ? (
				<Pagination total={total} limit={PAGE_SIZE} offset={offset} onOffsetChange={setOffset} />
			) : null}
		</section>
	)
}
