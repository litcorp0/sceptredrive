import { formatDateTime, formatDay } from "@sceptre/shared"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { ChevronLeftIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { ConfirmDialog } from "#/components/common/confirm-dialog"
import { PageHeader } from "#/components/common/page-header"
import { EditTransferDialog } from "#/components/inventory/edit-transfer-dialog"
import { ShortCloseDialog } from "#/components/inventory/short-close-dialog"
import { TransferQuantityDialog } from "#/components/inventory/transfer-quantity-dialog"
import { TransferStatusBadge } from "#/components/inventory/transfer-status-badge"
import { Button } from "#/components/ui/button"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table"
import { api } from "#/lib/api"
import { formatGhs } from "#/lib/format"
import { hasPermission } from "#/lib/role"
import { toastApiError } from "#/lib/toast"

export const Route = createFileRoute("/_authenticated/inventory/transfers/$transferId")({
	component: TransferDetailPage,
})

function TransferDetailPage() {
	const { transferId } = Route.useParams()
	const { session } = Route.useRouteContext()
	const queryClient = useQueryClient()

	const [editOpen, setEditOpen] = useState(false)
	const [dispatchOpen, setDispatchOpen] = useState(false)
	const [receiveOpen, setReceiveOpen] = useState(false)
	const [shortCloseOpen, setShortCloseOpen] = useState(false)
	const [cancelOpen, setCancelOpen] = useState(false)

	const canTransfer = hasPermission(session.user.role, "inventory.transfer")
	const isAdmin = session.user.role === "ADMIN"

	const transferQuery = useQuery({
		queryKey: ["transfer", transferId],
		queryFn: () => api.transfers.get(transferId),
	})

	const transfer = transferQuery.data?.transfer

	const cancelMutation = useMutation({
		mutationFn: () => api.transfers.cancel(transferId),
		onSuccess: async () => {
			toast.success("Transfer cancelled")
			await queryClient.invalidateQueries({ queryKey: ["transfers"] })
			await queryClient.invalidateQueries({ queryKey: ["transfer", transferId] })
			setCancelOpen(false)
		},
		onError: (error) => {
			toastApiError(error)
			setCancelOpen(false)
		},
	})

	if (transferQuery.isLoading) {
		return <p className="text-sm text-muted-foreground">Loading transfer…</p>
	}
	if (transferQuery.isError || !transfer) {
		return <p className="text-sm text-destructive">Could not load this transfer.</p>
	}

	const isSource = isAdmin || session.user.branchId === transfer.fromBranchId
	const isDestination = isAdmin || session.user.branchId === transfer.toBranchId
	const canEdit = canTransfer && transfer.status === "DRAFT" && (isSource || isDestination)
	const canDispatch = canTransfer && transfer.status === "DRAFT" && isSource
	const canReceive = canTransfer && transfer.status === "DISPATCHED" && isDestination
	const canShortClose = canReceive

	return (
		<section>
			<PageHeader
				title={`Transfer ${transfer.number}`}
				description={`${transfer.fromBranchCode} · ${transfer.fromBranchName} → ${transfer.toBranchCode} · ${transfer.toBranchName}`}
				actions={
					<div className="flex flex-wrap gap-2">
						<Button asChild variant="outline" size="sm">
							<Link to="/inventory/transfers">
								<ChevronLeftIcon className="size-4" aria-hidden="true" />
								Back
							</Link>
						</Button>
						{canEdit ? (
							<Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
								Edit lines
							</Button>
						) : null}
						{canDispatch ? (
							<Button size="sm" onClick={() => setDispatchOpen(true)}>
								Dispatch
							</Button>
						) : null}
						{canReceive ? (
							<Button size="sm" onClick={() => setReceiveOpen(true)}>
								Receive
							</Button>
						) : null}
						{canShortClose ? (
							<Button size="sm" variant="outline" onClick={() => setShortCloseOpen(true)}>
								Close short
							</Button>
						) : null}
						{canEdit ? (
							<Button
								size="sm"
								variant="ghost"
								className="text-destructive"
								onClick={() => setCancelOpen(true)}
							>
								Cancel transfer
							</Button>
						) : null}
					</div>
				}
			/>

			<div className="mb-5 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
				<TransferStatusBadge status={transfer.status} />
				<span>
					Requested {formatDay(transfer.createdAt)}
					{transfer.createdBy ? ` by ${transfer.createdBy}` : ""}
				</span>
				{transfer.dispatchedAt ? (
					<span>Dispatched {formatDateTime(transfer.dispatchedAt)}</span>
				) : null}
				{transfer.receivedAt ? (
					<span>Last receipt {formatDateTime(transfer.receivedAt)}</span>
				) : null}
				{transfer.closedAt ? <span>Short-closed {formatDateTime(transfer.closedAt)}</span> : null}
			</div>

			{transfer.note ? (
				<p className="mb-4 rounded-md border bg-muted/40 p-3 text-sm">{transfer.note}</p>
			) : null}

			<div className="rounded-md border">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>SKU</TableHead>
							<TableHead>Product</TableHead>
							<TableHead className="text-right">Requested</TableHead>
							<TableHead className="text-right">Dispatched</TableHead>
							<TableHead className="text-right">Received</TableHead>
							<TableHead className="text-right">Pending</TableHead>
							<TableHead className="text-right">Source on hand</TableHead>
							<TableHead className="text-right">Unit cost</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{(transfer.lines ?? []).map((line) => (
							<TableRow key={line.id}>
								<TableCell className="font-mono text-xs">{line.sku}</TableCell>
								<TableCell className="font-medium">{line.productName}</TableCell>
								<TableCell className="text-right tabular-nums">{line.quantityRequested}</TableCell>
								<TableCell className="text-right tabular-nums">{line.quantityDispatched}</TableCell>
								<TableCell className="text-right tabular-nums">{line.quantityReceived}</TableCell>
								<TableCell className="text-right tabular-nums">{line.pending}</TableCell>
								<TableCell className="text-right tabular-nums">{line.fromOnHand}</TableCell>
								<TableCell className="text-right tabular-nums">
									{line.quantityDispatched > 0 ? formatGhs(line.unitCostMinor) : "—"}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>

			<EditTransferDialog open={editOpen} onOpenChange={setEditOpen} transfer={transfer} />
			<TransferQuantityDialog
				open={dispatchOpen}
				onOpenChange={setDispatchOpen}
				transfer={transfer}
				mode="dispatch"
			/>
			<TransferQuantityDialog
				open={receiveOpen}
				onOpenChange={setReceiveOpen}
				transfer={transfer}
				mode="receive"
			/>
			<ShortCloseDialog
				open={shortCloseOpen}
				onOpenChange={setShortCloseOpen}
				transfer={transfer}
			/>
			<ConfirmDialog
				open={cancelOpen}
				onOpenChange={setCancelOpen}
				title="Cancel this transfer?"
				description="The draft is kept for history but can no longer be edited or dispatched."
				confirmLabel="Cancel transfer"
				destructive
				pending={cancelMutation.isPending}
				onConfirm={() => cancelMutation.mutate()}
			/>
		</section>
	)
}
