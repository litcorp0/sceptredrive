import { useMutation, useQueryClient } from "@tanstack/react-query"
import { type FormEvent, useRef, useState } from "react"
import { toast } from "sonner"
import { Button } from "#/components/ui/button"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog"
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select"
import { Textarea } from "#/components/ui/textarea"
import { ApiError } from "#/lib/api"
import { formatGhs } from "#/lib/format"
import { toastApiError } from "#/lib/toast"
// A purchase receipt is inventory's document; the dialog links to it and refreshes its reads.
import { inventoryKeys } from "#/modules/inventory"
import { orderKeys } from "../api/keys"
import { receiveOrder } from "../api/orders"
import type { OrderDetail, OrderLine, OverReceiptReason, ReceiveLineInput } from "../types"

interface ReceiveRowDraft {
	line: OrderLine
	quantity: string
	reason: OverReceiptReason | ""
	note: string
}

const REASON_LABELS: Record<OverReceiptReason, string> = {
	SUPPLIER_SENT_MORE: "Supplier sent more",
	ORDER_ROUNDING: "Order rounding",
	SUBSTITUTE: "Substitute product",
	OTHER: "Other",
}

const REASONS = Object.keys(REASON_LABELS) as OverReceiptReason[]

function initialRows(order: OrderDetail): ReceiveRowDraft[] {
	return order.lines.map((line) => ({
		line,
		quantity: String(line.outstandingQuantity),
		reason: "",
		note: "",
	}))
}

function parseQuantity(value: string): number {
	const parsed = Number.parseInt(value, 10)
	return Number.isInteger(parsed) && parsed > 0 ? parsed : 0
}

/**
 * Receive goods against an order.
 *
 * This is the one screen where a mistake costs money, so every line shows what was ordered, what
 * already arrived, what is arriving now and what will still be outstanding. An over-delivery needs
 * a reason before the submit button unlocks; the API refuses it too, and the server records the
 * excess rather than clamping it.
 */
export function ReceiveOrderDialog({
	order,
	onClose,
}: {
	order: OrderDetail
	onClose: () => void
}) {
	const queryClient = useQueryClient()
	const [rows, setRows] = useState<ReceiveRowDraft[]>(() => initialRows(order))
	const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState("")
	const [note, setNote] = useState("")
	const [formError, setFormError] = useState<string | null>(null)

	// One key per dialog session: a network failure retries the same receipt (the API replays it),
	// while a server response ends the session.
	const idempotencyKey = useRef<string>(crypto.randomUUID())

	const quantityNow = rows.reduce((sum, row) => sum + parseQuantity(row.quantity), 0)
	const orderedTotal = order.lines.reduce((sum, line) => sum + line.quantity, 0)
	const outstandingAfter = rows.reduce(
		(sum, row) => sum + Math.max(row.line.outstandingQuantity - parseQuantity(row.quantity), 0),
		0,
	)
	const overRows = rows.filter((row) => parseQuantity(row.quantity) > row.line.outstandingQuantity)
	const missingReasons = overRows.filter((row) => row.reason === "")
	const completes = quantityNow > 0 && outstandingAfter === 0

	const receiveMutation = useMutation({
		mutationFn: () => {
			const lines: ReceiveLineInput[] = rows
				.filter((row) => parseQuantity(row.quantity) > 0)
				.map((row) => {
					const quantity = parseQuantity(row.quantity)
					const over = quantity > row.line.outstandingQuantity
					return {
						purchaseOrderLineId: row.line.id,
						quantity,
						unitCostMinor: row.line.unitCostMinor,
						...(over ? { overReceiptReason: row.reason as OverReceiptReason } : {}),
						...(over && row.note.trim() ? { overReceiptNote: row.note.trim() } : {}),
					}
				})
			return receiveOrder(order.order.id, {
				idempotencyKey: idempotencyKey.current,
				supplierInvoiceNumber: supplierInvoiceNumber.trim() || undefined,
				note: note.trim() || undefined,
				lines,
			})
		},
		onSuccess: async (data) => {
			toast.success(
				data.replayed
					? `Receipt ${data.receipt.number} was already recorded`
					: `Goods received as ${data.receipt.number}`,
			)
			// The response carries the refreshed order, so the screen updates without waiting for a
			// second read; the list and the stock reads are still invalidated.
			queryClient.setQueryData(orderKeys.byId(order.order.id), data.order)
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: orderKeys.all }),
				queryClient.invalidateQueries({ queryKey: inventoryKeys.stock }),
				queryClient.invalidateQueries({ queryKey: inventoryKeys.movements }),
				queryClient.invalidateQueries({ queryKey: inventoryKeys.receipts }),
			])
			onClose()
		},
		onError: (error) => {
			if (error instanceof ApiError && (error.status === 400 || error.status === 409)) {
				setFormError(error.message)
				return
			}
			toastApiError(error)
		},
	})

	function updateRow(key: string, patch: Partial<ReceiveRowDraft>) {
		setRows((current) =>
			current.map((row) => (row.line.id === key ? { ...row, ...patch } : row)),
		)
	}

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		setFormError(null)
		if (quantityNow === 0) {
			setFormError("Enter the quantity received on at least one line.")
			return
		}
		if (missingReasons.length > 0) {
			setFormError("An over-delivery needs a reason on every line it applies to.")
			return
		}
		receiveMutation.mutate()
	}

	const busy = receiveMutation.isPending

	return (
		<Dialog
			open
			onOpenChange={(next) => {
				if (!next) onClose()
			}}
		>
			<DialogContent className="sm:max-w-3xl">
				<DialogHeader>
					<DialogTitle>Receive against {order.order.number}</DialogTitle>
					<DialogDescription>
						{order.order.supplierName} · {order.order.supplierCode}. The receipt, its stock
						movements and the supplier-product cost are written in one server transaction.
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="grid gap-4">
					<div className="grid gap-2">
						{rows.map((row, index) => {
							const quantity = parseQuantity(row.quantity)
							const over = quantity > row.line.outstandingQuantity
							const after = Math.max(row.line.outstandingQuantity - quantity, 0)
							return (
								<div
									key={row.line.id}
									className="grid gap-2 rounded-md border p-2 sm:grid-cols-[minmax(0,1fr)_90px_90px_90px_130px]"
								>
									<div className="min-w-0">
										<p className="truncate text-sm font-medium">{row.line.name}</p>
										<p className="font-mono text-xs text-muted-foreground">{row.line.sku}</p>
										<p className="mt-1 text-xs text-muted-foreground">
											Ordered {row.line.quantity} · received {row.line.receivedQuantity} · unit cost{" "}
											{formatGhs(row.line.unitCostMinor)}
										</p>
									</div>
									<div className="grid gap-1">
										<span className="text-xs text-muted-foreground">Outstanding</span>
										<span className="py-2 text-sm tabular-nums">
											{row.line.outstandingQuantity}
										</span>
									</div>
									<div className="grid gap-1">
										<Label className="text-xs" htmlFor={`receive-qty-${row.line.id}`}>
											Receiving now
										</Label>
										<Input
											id={`receive-qty-${row.line.id}`}
											inputMode="numeric"
											value={row.quantity}
											disabled={busy}
											onChange={(event) =>
												updateRow(row.line.id, { quantity: event.target.value })
											}
											aria-label={`Receiving now for line ${index + 1}`}
										/>
									</div>
									<div className="grid gap-1">
										<span className="text-xs text-muted-foreground">Outstanding after</span>
										<span className="py-2 text-sm tabular-nums">{after}</span>
									</div>
									<div className="grid gap-1">
										<span className="text-xs text-muted-foreground">Line value</span>
										<span className="py-2 text-sm tabular-nums">
											{formatGhs(quantity * row.line.unitCostMinor)}
										</span>
									</div>

									{over ? (
										<div className="grid gap-2 sm:col-span-5 sm:grid-cols-2">
											<div className="grid gap-1.5">
												<Label
													className="text-xs"
													htmlFor={`receive-reason-${row.line.id}`}
												>
													Over-delivery reason (required)
												</Label>
												<Select
													value={row.reason || undefined}
													onValueChange={(value) =>
														updateRow(row.line.id, {
															reason: value as OverReceiptReason,
														})
													}
													disabled={busy}
												>
													<SelectTrigger
														id={`receive-reason-${row.line.id}`}
														className="w-full"
													>
														<SelectValue placeholder="Why is more arriving?" />
													</SelectTrigger>
													<SelectContent>
														{REASONS.map((reason) => (
															<SelectItem key={reason} value={reason}>
																{REASON_LABELS[reason]}
															</SelectItem>
														))}
													</SelectContent>
												</Select>
												<p className="text-xs text-muted-foreground">
													Receiving {quantity}, {quantity - row.line.outstandingQuantity} more
													than outstanding. The excess is recorded, never removed.
												</p>
											</div>
											<div className="grid gap-1.5">
												<Label
													className="text-xs"
													htmlFor={`receive-note-${row.line.id}`}
												>
													Reason note (optional)
												</Label>
												<Input
													id={`receive-note-${row.line.id}`}
													value={row.note}
													disabled={busy}
													maxLength={300}
													onChange={(event) =>
														updateRow(row.line.id, { note: event.target.value })
													}
												/>
											</div>
										</div>
									) : null}
								</div>
							)
						})}
					</div>

					<div className="grid gap-3 sm:grid-cols-2">
						<div className="grid gap-1.5">
							<Label htmlFor="receive-invoice-number">
								Supplier invoice number (optional)
							</Label>
							<Input
								id="receive-invoice-number"
								value={supplierInvoiceNumber}
								disabled={busy}
								maxLength={60}
								onChange={(event) => setSupplierInvoiceNumber(event.target.value)}
							/>
						</div>
						<div className="grid gap-1.5">
							<Label htmlFor="receive-note">Note (optional)</Label>
							<Textarea
								id="receive-note"
								rows={2}
								maxLength={300}
								value={note}
								disabled={busy}
								onChange={(event) => setNote(event.target.value)}
							/>
						</div>
					</div>

					<p className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
						{quantityNow === 0
							? "Enter the quantity arriving on each line."
							: completes
								? `This completes the order — all ${orderedTotal} units are received.`
								: `This will leave the order partly received — ${outstandingAfter} of ${orderedTotal} outstanding.`}
					</p>

					{missingReasons.length > 0 ? (
						<p className="text-sm text-destructive">
							A reason is required for {missingReasons.length} over-delivered line
							{missingReasons.length === 1 ? "" : "s"} before this can be submitted.
						</p>
					) : null}

					{formError ? (
						<p role="alert" className="text-sm text-destructive">
							{formError}
						</p>
					) : null}

					<DialogFooter>
						<Button type="button" variant="outline" onClick={onClose} disabled={busy}>
							Cancel
						</Button>
						<Button
							type="submit"
							disabled={busy || quantityNow === 0 || missingReasons.length > 0}
						>
							{busy ? "Receiving…" : "Receive goods"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
