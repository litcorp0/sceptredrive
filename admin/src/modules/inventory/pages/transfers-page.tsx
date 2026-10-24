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
import { hasPermission } from "#/lib/role"
import { transferListOptions } from "../api/transfers"
import { TransferStatusBadge } from "../components/transfer-status-badge"
import type { TransferStatus } from "../types"

const authenticatedRoute = getRouteApi("/_authenticated")

const PAGE_SIZE = 25
const ALL = "all"

export function TransfersPage() {
	const { session } = authenticatedRoute.useRouteContext()
	const { activeBranchId } = useBranch()
	const navigate = useNavigate()
	const canTransfer = hasPermission(session.user.role, "inventory.transfer")

	const [status, setStatus] = useState<"all" | TransferStatus>("all")
	const [direction, setDirection] = useState<"all" | "from" | "to">("all")
	const [offset, setOffset] = useState(0)

	const filters = {
		branchId: activeBranchId ?? undefined,
		status: status === ALL ? undefined : status,
		direction: direction === ALL ? undefined : direction,
		limit: PAGE_SIZE,
		offset,
	}

	const transfersQuery = useQuery(transferListOptions(filters))

	const rows = transfersQuery.data?.transfers ?? []
	const total = transfersQuery.data?.total ?? 0

	return (
		<section>
			<div className="mb-3 flex flex-wrap items-end gap-3">
				<Select
					value={status}
					onValueChange={(value) => {
						setStatus(value as "all" | TransferStatus)
						setOffset(0)
					}}
				>
					<SelectTrigger className="w-48" aria-label="Filter by status">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">All statuses</SelectItem>
						<SelectItem value="DRAFT">Draft</SelectItem>
						<SelectItem value="DISPATCHED">Dispatched</SelectItem>
						<SelectItem value="RECEIVED">Received</SelectItem>
						<SelectItem value="SHORT_CLOSED">Short closed</SelectItem>
						<SelectItem value="CANCELLED">Cancelled</SelectItem>
					</SelectContent>
				</Select>

				<Select
					value={direction}
					onValueChange={(value) => {
						setDirection(value as "all" | "from" | "to")
						setOffset(0)
					}}
				>
					<SelectTrigger className="w-44" aria-label="Filter by direction">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">All directions</SelectItem>
						<SelectItem value="from">Outgoing</SelectItem>
						<SelectItem value="to">Incoming</SelectItem>
					</SelectContent>
				</Select>

				{canTransfer ? (
					<Button
						size="sm"
						className="ml-auto"
						onClick={() => void navigate({ to: "/inventory/transfers/new" })}
					>
						<PlusIcon className="size-4" aria-hidden="true" />
						New transfer
					</Button>
				) : null}
			</div>

			<div className="rounded-md border">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Number</TableHead>
							<TableHead>From</TableHead>
							<TableHead>To</TableHead>
							<TableHead>Status</TableHead>
							<TableHead className="text-right">Lines</TableHead>
							<TableHead className="text-right">Dispatched</TableHead>
							<TableHead className="text-right">Received</TableHead>
							<TableHead>Created</TableHead>
							<TableHead className="w-16" />
						</TableRow>
					</TableHeader>
					<TableBody>
						{transfersQuery.isLoading ? (
							<TableRow>
								<TableCell colSpan={9} className="text-muted-foreground">
									Loading transfers…
								</TableCell>
							</TableRow>
						) : transfersQuery.isError ? (
							<TableRow>
								<TableCell colSpan={9} className="text-destructive">
									Could not load transfers.
								</TableCell>
							</TableRow>
						) : rows.length === 0 ? (
							<TableRow>
								<TableCell colSpan={9} className="text-muted-foreground">
									No transfers yet. Create one to move stock between branches.
								</TableCell>
							</TableRow>
						) : (
							rows.map((transfer) => (
								<TableRow key={transfer.id}>
									<TableCell className="font-mono text-xs">{transfer.number}</TableCell>
									<TableCell>
										{transfer.fromBranchCode}
										<span className="block text-xs text-muted-foreground">
											{transfer.fromBranchName}
										</span>
									</TableCell>
									<TableCell>
										{transfer.toBranchCode}
										<span className="block text-xs text-muted-foreground">
											{transfer.toBranchName}
										</span>
									</TableCell>
									<TableCell>
										<TransferStatusBadge status={transfer.status} />
									</TableCell>
									<TableCell className="text-right tabular-nums">{transfer.lineCount}</TableCell>
									<TableCell className="text-right tabular-nums">
										{transfer.unitsDispatched}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{transfer.unitsReceived}
									</TableCell>
									<TableCell className="whitespace-nowrap text-muted-foreground">
										{formatDay(transfer.createdAt)}
									</TableCell>
									<TableCell>
										<Link
											to="/inventory/transfers/$transferId"
											params={{ transferId: transfer.id }}
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

			{transfersQuery.isSuccess ? (
				<Pagination total={total} limit={PAGE_SIZE} offset={offset} onOffsetChange={setOffset} />
			) : null}
		</section>
	)
}
