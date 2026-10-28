import { formatBranchLabel, formatDateTime, formatDay } from "@sceptre/shared"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { getRouteApi, Link } from "@tanstack/react-router"
import { ChevronLeftIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { ConfirmDialog } from "#/components/common/confirm-dialog"
import { PageHeader } from "#/components/common/page-header"
import { StatusNote } from "#/components/common/status-note"
import { Button } from "#/components/ui/button"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table"
import { formatGhs } from "#/lib/format"
import { hasPermission } from "#/lib/role"
import { toastApiError } from "#/lib/toast"
import { transferKeys } from "../api/keys"
import { cancelTransfer, transferDetailOptions } from "../api/transfers"
import { ApprovalSummaryCard } from "../components/approval-summary-card"
import { EditTransferDialog } from "../components/edit-transfer-dialog"
import { ShortCloseDialog } from "../components/short-close-dialog"
import { TransferQuantityDialog } from "../components/transfer-quantity-dialog"
import { TransferStatusBadge } from "../components/transfer-status-badge"
import { approvalReasonLabel } from "../utils/approval"

const authenticatedRoute = getRouteApi("/_authenticated")
const transferRoute = getRouteApi("/_authenticated/inventory/transfers/$transferId")

/**
 * One transfer, its lines and — when it came from a branch request — the decision behind it.
 *
 * Dispatch is offered from `transfer.canDispatch`, computed by the API for this actor and this
 * status; the console does not reconstruct the rule. A `REQUESTED` document offers Withdraw
 * instead of Cancel, and a `REJECTED` one offers no transition at all.
 */
export function TransferDetailPage() {
	const { transferId } = transferRoute.useParams()
	const { session } = authenticatedRoute.useRouteContext()
	const queryClient = useQueryClient()

	const [editOpen, setEditOpen] = useState(false)
	const [dispatchOpen, setDispatchOpen] = useState(false)
	const [receiveOpen, setReceiveOpen] = useState(false)
	const [shortCloseOpen, setShortCloseOpen] = useState(false)
	const [cancelOpen, setCancelOpen] = useState(false)

	const canTransfer = hasPermission(session.user.role, "inventory.transfer")
	const isAdmin = session.user.role === "ADMIN"

	const transferQuery = useQuery(transferDetailOptions(transferId))

	const transfer = transferQuery.data?.transfer
	const approval = transfer?.approval ?? null

	const cancelMutation = useMutation({
		mutationFn: () => cancelTransfer(transferId),
		onSuccess: async () => {
			toast.success(transfer?.status === "REQUESTED" ? "Request withdrawn" : "Transfer cancelled")
			await queryClient.invalidateQueries({ queryKey: transferKeys.all })
			await queryClient.invalidateQueries({ queryKey: transferKeys.detail(transferId) })
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
	const canDispatch = canTransfer && transfer.canDispatch
	const canWithdraw = canTransfer && transfer.status === "REQUESTED" && (isSource || isDestination)
	const canReceive = canTransfer && transfer.status === "DISPATCHED" && isDestination
	const canShortClose = canReceive
	const requesting = transfer.status === "REQUESTED"

	return (
		<section>
			<PageHeader
				title={`Transfer ${transfer.number}`}
				description={`${formatBranchLabel({ name: transfer.fromBranchName, code: transfer.fromBranchCode })} → ${formatBranchLabel({ name: transfer.toBranchName, code: transfer.toBranchCode })}`}
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
						{canWithdraw ? (
							<Button size="sm" variant="ghost" onClick={() => setCancelOpen(true)}>
								Withdraw request
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

			<div className="mb-4 grid gap-3">
				{requesting ? (
					<StatusNote tone="info">
						Waiting for the source branch, {transfer.fromBranchName}, to decide this request. Stock
						has not moved; the destination may withdraw it until a decision is recorded.
					</StatusNote>
				) : null}
				{transfer.status === "REJECTED" && approval ? (
					<StatusNote tone="danger" title="This request was rejected">
						{approvalReasonLabel(approval.decisionReasonCode)}. No stock moved, and the transfer
						cannot be dispatched from here.
					</StatusNote>
				) : null}
				{approval ? (
					<ApprovalSummaryCard
						title="Approval"
						approval={approval}
						branchName={transfer.fromBranchName}
					/>
				) : null}
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
				title={requesting ? "Withdraw this request?" : "Cancel this transfer?"}
				description={
					requesting
						? `The request is withdrawn from ${transfer.fromBranchName}'s queue and no stock moves. You can raise a new request if it is still needed.`
						: "The draft is kept for history but can no longer be edited or dispatched."
				}
				confirmLabel={requesting ? "Withdraw request" : "Cancel transfer"}
				destructive
				pending={cancelMutation.isPending}
				onConfirm={() => cancelMutation.mutate()}
			/>
		</section>
	)
}
