import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { toast } from "sonner"
import { ConfirmDialog } from "#/components/common/confirm-dialog"
import { Button } from "#/components/ui/button"
import { Label } from "#/components/ui/label"
import { Textarea } from "#/components/ui/textarea"
import { ApiError } from "#/lib/api"
import { formatGhs } from "#/lib/format"
import { toastApiError } from "#/lib/toast"
import { approvalKeys } from "#/modules/approvals"
import { orderKeys } from "../api/keys"
import { cancelOrder, closeOrder, sendOrder, submitOrder } from "../api/orders"
import type { OrderDetail } from "../types"
import { ReceiveOrderDialog } from "./receive-dialog"

type ActionDialog = "submit" | "send" | "close" | "cancel" | null

/**
 * The order lifecycle buttons.
 *
 * Every button is rendered from the server's `canApply`, so the screen cannot offer a transition
 * the service would refuse. The dialogs collect exactly what the API requires: a reason to cancel,
 * an optional note to close.
 */
export function OrderActions({ order }: { order: OrderDetail }) {
	const queryClient = useQueryClient()
	const [dialog, setDialog] = useState<ActionDialog>(null)
	const [receiveOpen, setReceiveOpen] = useState(false)
	const [cancelReason, setCancelReason] = useState("")
	const [closeNote, setCloseNote] = useState("")
	const [actionError, setActionError] = useState<string | null>(null)

	const id = order.order.id

	async function refresh() {
		await Promise.all([
			queryClient.invalidateQueries({ queryKey: orderKeys.byId(id) }),
			queryClient.invalidateQueries({ queryKey: orderKeys.all }),
			queryClient.invalidateQueries({ queryKey: approvalKeys.all }),
		])
	}

	function handleError(error: unknown) {
		if (error instanceof ApiError && (error.status === 400 || error.status === 409)) {
			setActionError(error.message)
			return
		}
		toastApiError(error)
	}

	const submitMutation = useMutation({
		mutationFn: () => submitOrder(id),
		onSuccess: async (data) => {
			toast.success(
				data.order.status === "APPROVED"
					? `Order ${data.order.number} was approved automatically`
					: `Order ${data.order.number} is awaiting approval`,
			)
			setDialog(null)
			await refresh()
		},
		onError: handleError,
	})

	const sendMutation = useMutation({
		mutationFn: () => sendOrder(id),
		onSuccess: async (data) => {
			toast.success(`Order ${data.order.number} marked as sent`)
			setDialog(null)
			await refresh()
		},
		onError: handleError,
	})

	const closeMutation = useMutation({
		mutationFn: () => closeOrder(id, { note: closeNote.trim() || undefined }),
		onSuccess: async (data) => {
			toast.success(`Order ${data.order.number} closed`)
			setDialog(null)
			setCloseNote("")
			await refresh()
		},
		onError: handleError,
	})

	const cancelMutation = useMutation({
		mutationFn: () => cancelOrder(id, { reason: cancelReason.trim() }),
		onSuccess: async (data) => {
			toast.success(`Order ${data.order.number} cancelled`)
			setDialog(null)
			setCancelReason("")
			await refresh()
		},
		onError: handleError,
	})

	function open(next: ActionDialog) {
		setActionError(null)
		setDialog(next)
	}

	const { canApply } = order
	const hasActions = canApply.submit || canApply.send || canApply.receive || canApply.close
	if (!hasActions && !canApply.cancel) return null

	return (
		<div className="flex flex-wrap items-center gap-2">
			{canApply.submit ? <Button onClick={() => open("submit")}>Submit for approval</Button> : null}
			{canApply.receive ? (
				<Button onClick={() => setReceiveOpen(true)}>Receive goods</Button>
			) : null}
			{canApply.send ? (
				<Button variant="outline" onClick={() => open("send")}>
					Mark as sent
				</Button>
			) : null}
			{canApply.close ? (
				<Button variant="outline" onClick={() => open("close")}>
					Close order
				</Button>
			) : null}
			{canApply.cancel ? (
				<Button
					variant="outline"
					className="text-destructive hover:text-destructive"
					onClick={() => open("cancel")}
				>
					Cancel order
				</Button>
			) : null}

			<ConfirmDialog
				open={dialog === "submit"}
				onOpenChange={(next) => {
					if (!next) setDialog(null)
				}}
				title="Submit this order?"
				description={
					<>
						The goods value is {formatGhs(order.goodsValueMinor)}. At or above the approval limit of{" "}
						{formatGhs(order.threshold.valueMinor)} an administrator decides; below it the order is
						approved automatically.
					</>
				}
				confirmLabel="Submit"
				pending={submitMutation.isPending}
				onConfirm={() => submitMutation.mutate()}
			>
				{actionError ? (
					<p role="alert" className="text-sm text-destructive">
						{actionError}
					</p>
				) : null}
			</ConfirmDialog>

			<ConfirmDialog
				open={dialog === "send"}
				onOpenChange={(next) => {
					if (!next) setDialog(null)
				}}
				title="Mark this order as sent?"
				description="The supplier has been given the order. Goods can be received against it from now on."
				confirmLabel="Mark as sent"
				pending={sendMutation.isPending}
				onConfirm={() => sendMutation.mutate()}
			>
				{actionError ? (
					<p role="alert" className="text-sm text-destructive">
						{actionError}
					</p>
				) : null}
			</ConfirmDialog>

			<ConfirmDialog
				open={dialog === "close"}
				onOpenChange={(next) => {
					if (!next) setDialog(null)
				}}
				title="Close this order?"
				description="Closing ends the order with whatever has been received. Outstanding units are not ordered again."
				confirmLabel="Close order"
				pending={closeMutation.isPending}
				onConfirm={() => closeMutation.mutate()}
			>
				<div className="grid gap-1.5">
					<Label htmlFor="order-close-note">Note (optional)</Label>
					<Textarea
						id="order-close-note"
						rows={2}
						maxLength={300}
						value={closeNote}
						onChange={(event) => setCloseNote(event.target.value)}
					/>
				</div>
				{actionError ? (
					<p role="alert" className="text-sm text-destructive">
						{actionError}
					</p>
				) : null}
			</ConfirmDialog>

			<ConfirmDialog
				open={dialog === "cancel"}
				onOpenChange={(next) => {
					if (!next) setDialog(null)
				}}
				title="Cancel this order?"
				description="A cancelled order cannot be reopened. If goods already arrived, the API refuses and asks you to close it instead."
				confirmLabel="Cancel order"
				destructive
				pending={cancelMutation.isPending}
				onConfirm={() => {
					if (cancelReason.trim().length < 3) {
						setActionError("Enter a reason of at least three characters.")
						return
					}
					cancelMutation.mutate()
				}}
			>
				<div className="grid gap-1.5">
					<Label htmlFor="order-cancel-reason">Reason (required)</Label>
					<Textarea
						id="order-cancel-reason"
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

			{receiveOpen ? (
				<ReceiveOrderDialog order={order} onClose={() => setReceiveOpen(false)} />
			) : null}
		</div>
	)
}
