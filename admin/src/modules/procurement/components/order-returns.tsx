import { formatDay } from "@sceptre/shared"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { toast } from "sonner"
import { ConfirmDialog } from "#/components/common/confirm-dialog"
import { StatusBadge } from "#/components/common/status-badge"
import { Button } from "#/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card"
import { Label } from "#/components/ui/label"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table"
import { Textarea } from "#/components/ui/textarea"
import { ApiError } from "#/lib/api"
import { formatGhs } from "#/lib/format"
import { hasPermission } from "#/lib/role"
import { toastApiError } from "#/lib/toast"
import { inventoryKeys } from "#/modules/inventory"
import { orderKeys, returnKeys } from "../api/keys"
import { cancelReturn, postReturn, returnListOptions } from "../api/returns"
import type { OrderDetail, ReturnListRow } from "../types"
import { returnStatusLabel, returnStatusTone } from "../utils/order"
import { ReturnDialog } from "./return-dialog"

/**
 * The supplier returns raised against this order, with the credit note each posted return created.
 *
 * The list read is branch-and-supplier scoped; this screen only shows the returns whose
 * `purchaseOrderId` is this order. A draft can be posted or cancelled here so a return abandoned
 * mid-flow is not stranded.
 */
export function OrderReturns({ order, role }: { order: OrderDetail; role: string }) {
	const queryClient = useQueryClient()
	const [returnOpen, setReturnOpen] = useState(false)
	const [postTarget, setPostTarget] = useState<ReturnListRow | null>(null)
	const [cancelTarget, setCancelTarget] = useState<ReturnListRow | null>(null)
	const [cancelReason, setCancelReason] = useState("")
	const [actionError, setActionError] = useState<string | null>(null)

	const canReturn = hasPermission(role, "procurement.return")
	const canStart = canReturn && order.lines.some((line) => line.receivedQuantity > 0)

	const returnsQuery = useQuery(
		returnListOptions({
			branchId: order.order.branchId,
			supplierId: order.order.supplierId,
			limit: 100,
		}),
	)
	const returns = (returnsQuery.data?.returns ?? []).filter(
		(row) => row.purchaseOrderId === order.order.id,
	)

	async function refresh() {
		await Promise.all([
			queryClient.invalidateQueries({ queryKey: returnKeys.all }),
			queryClient.invalidateQueries({ queryKey: orderKeys.byId(order.order.id) }),
			queryClient.invalidateQueries({ queryKey: orderKeys.all }),
			queryClient.invalidateQueries({ queryKey: inventoryKeys.stock }),
			queryClient.invalidateQueries({ queryKey: inventoryKeys.movements }),
		])
	}

	function handleError(error: unknown) {
		if (error instanceof ApiError && (error.status === 400 || error.status === 409)) {
			setActionError(error.message)
			return
		}
		toastApiError(error)
	}

	const postMutation = useMutation({
		mutationFn: (id: string) => postReturn(id),
		onSuccess: async (data) => {
			toast.success(
				data.creditNote
					? `Return ${data.supplierReturn.number} posted — credit note ${data.creditNote.number}`
					: `Return ${data.supplierReturn.number} posted`,
			)
			setPostTarget(null)
			await refresh()
		},
		onError: handleError,
	})

	const cancelMutation = useMutation({
		mutationFn: ({ id, reason }: { id: string; reason: string }) => cancelReturn(id, reason),
		onSuccess: async (data) => {
			toast.success(`Return ${data.supplierReturn.number} cancelled`)
			setCancelTarget(null)
			setCancelReason("")
			await refresh()
		},
		onError: handleError,
	})

	return (
		<Card>
			<CardHeader>
				<CardTitle>Supplier returns</CardTitle>
				<CardDescription>
					Goods sent back and the credit notes they created. A posted return has already moved stock
					and reduced what this branch owes.
				</CardDescription>
			</CardHeader>
			<CardContent className="grid gap-3">
				{canStart ? (
					<div className="flex justify-end">
						<Button size="sm" variant="outline" onClick={() => setReturnOpen(true)}>
							Return goods
						</Button>
					</div>
				) : null}

				{returnsQuery.isLoading ? (
					<p className="text-sm text-muted-foreground">Loading returns…</p>
				) : returnsQuery.isError ? (
					<p role="alert" className="text-sm text-destructive">
						Couldn't load supplier returns.
					</p>
				) : returns.length === 0 ? (
					<p className="text-sm text-muted-foreground">No returns recorded against this order.</p>
				) : (
					<div className="overflow-x-auto rounded-lg border">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Return</TableHead>
									<TableHead className="w-28">Status</TableHead>
									<TableHead>Reason</TableHead>
									<TableHead className="w-32">Credit note</TableHead>
									<TableHead className="w-28 text-right">Credit</TableHead>
									<TableHead className="w-28">Posted</TableHead>
									<TableHead className="w-32" />
								</TableRow>
							</TableHeader>
							<TableBody>
								{returns.map((row) => (
									<TableRow key={row.id}>
										<TableCell className="font-mono text-xs">{row.number}</TableCell>
										<TableCell>
											<StatusBadge variant={returnStatusTone(row.status)}>
												{returnStatusLabel(row.status)}
											</StatusBadge>
										</TableCell>
										<TableCell className="max-w-56 text-muted-foreground">{row.reason}</TableCell>
										<TableCell className="font-mono text-xs text-muted-foreground">
											{row.creditNoteNumber ?? "—"}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{row.creditMinor === null ? "—" : formatGhs(row.creditMinor)}
										</TableCell>
										<TableCell className="text-muted-foreground">
											{row.postedAt ? formatDay(row.postedAt) : "—"}
										</TableCell>
										<TableCell className="text-right">
											{canReturn && row.status === "DRAFT" ? (
												<div className="flex justify-end gap-1">
													<Button
														size="sm"
														variant="ghost"
														onClick={() => {
															setActionError(null)
															setPostTarget(row)
														}}
													>
														Post
													</Button>
													<Button
														size="sm"
														variant="ghost"
														className="text-destructive hover:text-destructive"
														onClick={() => {
															setActionError(null)
															setCancelTarget(row)
														}}
													>
														Cancel
													</Button>
												</div>
											) : null}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				)}
			</CardContent>

			{returnOpen ? <ReturnDialog order={order} onClose={() => setReturnOpen(false)} /> : null}

			<ConfirmDialog
				open={postTarget !== null}
				onOpenChange={(next) => {
					if (!next) setPostTarget(null)
				}}
				title="Post this return?"
				description={
					postTarget
						? `Return ${postTarget.number} will move the returned units out of stock and create the credit note. This cannot be undone; a mistake needs a compensating document.`
						: undefined
				}
				confirmLabel="Post return"
				pending={postMutation.isPending}
				onConfirm={() => {
					if (postTarget) postMutation.mutate(postTarget.id)
				}}
			>
				{actionError ? (
					<p role="alert" className="text-sm text-destructive">
						{actionError}
					</p>
				) : null}
			</ConfirmDialog>

			<ConfirmDialog
				open={cancelTarget !== null}
				onOpenChange={(next) => {
					if (!next) setCancelTarget(null)
				}}
				title="Cancel this draft return?"
				description="Nothing has moved yet, so cancelling only closes the worksheet."
				confirmLabel="Cancel return"
				destructive
				pending={cancelMutation.isPending}
				onConfirm={() => {
					if (!cancelTarget) return
					if (cancelReason.trim().length < 3) {
						setActionError("Enter a reason of at least three characters.")
						return
					}
					cancelMutation.mutate({ id: cancelTarget.id, reason: cancelReason.trim() })
				}}
			>
				<div className="grid gap-1.5">
					<Label htmlFor="return-cancel-reason">Reason (required)</Label>
					<Textarea
						id="return-cancel-reason"
						rows={2}
						maxLength={300}
						value={cancelReason}
						onChange={(event) => setCancelReason(event.target.value)}
					/>
				</div>
				{actionError ? (
					<p role="alert" className="text-sm text-destructive">
						{actionError}
					</p>
				) : null}
			</ConfirmDialog>
		</Card>
	)
}
