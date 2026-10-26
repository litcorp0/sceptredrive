import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { type FormEvent, useEffect, useRef, useState } from "react"
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
// A return is built from receipt lines, and receipts are inventory's documents.
import { type InventoryReceipt, inventoryKeys, receiptListOptions } from "#/modules/inventory"
import { orderKeys, returnKeys } from "../api/keys"
import { createReturn, postReturn, returnableReceiptOptions } from "../api/returns"
import type { OrderDetail, ReturnDetail } from "../types"

interface ReturnRowDraft {
	receiptLineId: string
	sku: string
	name: string
	unitCostMinor: number
	received: number
	returned: number
	returnable: number
	quantity: string
}

function parseQuantity(value: string): number {
	const parsed = Number.parseInt(value, 10)
	return Number.isInteger(parsed) && parsed > 0 ? parsed : 0
}

/**
 * Return goods to a supplier.
 *
 * The dialog creates a DRAFT first and then asks for a second, explicitly labelled confirmation
 * before posting: posting moves stock and creates the credit note, and one mis-click must not do
 * both. The receipt picker lists the branch's receipts for this order's supplier; the API derives
 * the purchase order from the receipt line, so the screen cannot claim a link that is not there.
 */
export function ReturnDialog({ order, onClose }: { order: OrderDetail; onClose: () => void }) {
	const queryClient = useQueryClient()
	const [receiptId, setReceiptId] = useState("")
	const [rows, setRows] = useState<ReturnRowDraft[]>([])
	const [loadedReceiptId, setLoadedReceiptId] = useState("")
	const [reason, setReason] = useState("")
	const [note, setNote] = useState("")
	const [supplierCreditNoteNumber, setSupplierCreditNoteNumber] = useState("")
	const [formError, setFormError] = useState<string | null>(null)
	const [created, setCreated] = useState<ReturnDetail | null>(null)
	const idempotencyKey = useRef<string>(crypto.randomUUID())

	const receiptsQuery = useQuery(
		receiptListOptions({
			branchId: order.order.branchId,
			purchaseOrderId: order.order.id,
			limit: 50,
		}),
	)
	const returnableQuery = useQuery({
		...returnableReceiptOptions(receiptId),
		enabled: receiptId !== "",
	})

	useEffect(() => {
		const returnable = returnableQuery.data
		if (!returnable || returnable.receipt.id === loadedReceiptId) return
		setLoadedReceiptId(returnable.receipt.id)
		setRows(
			returnable.lines.map((line) => ({
				receiptLineId: line.id,
				sku: line.sku,
				name: line.name,
				unitCostMinor: line.unitCostMinor,
				received: line.receivedQuantity,
				returned: line.returnedQuantity,
				returnable: line.returnableQuantity,
				quantity: "",
			})),
		)
		setCreated(null)
		setFormError(null)
	}, [returnableQuery.data, loadedReceiptId])

	const receipt: InventoryReceipt | undefined = returnableQuery.data?.receipt as
		| InventoryReceipt
		| undefined
	const receiptOptions = (receiptsQuery.data?.receipts ?? []).filter(
		(option) => option.supplierId === order.order.supplierId,
	)

	const proposedQuantity = rows.reduce((sum, row) => sum + parseQuantity(row.quantity), 0)
	const creditPreviewMinor = rows.reduce(
		(sum, row) => sum + parseQuantity(row.quantity) * row.unitCostMinor,
		0,
	)

	const createMutation = useMutation({
		mutationFn: () =>
			createReturn({
				branchId: order.order.branchId,
				supplierId: order.order.supplierId,
				receiptId: receipt?.id,
				reason: reason.trim(),
				note: note.trim() || undefined,
				supplierCreditNoteNumber: supplierCreditNoteNumber.trim() || undefined,
				idempotencyKey: idempotencyKey.current,
				lines: rows
					.filter((row) => parseQuantity(row.quantity) > 0)
					.map((row) => ({
						receiptLineId: row.receiptLineId,
						quantity: parseQuantity(row.quantity),
					})),
			}),
		onSuccess: async (data) => {
			toast.success(`Draft return ${data.supplierReturn.number} created`)
			setCreated(data)
			await queryClient.invalidateQueries({ queryKey: returnKeys.all })
		},
		onError: (error) => {
			if (error instanceof ApiError && (error.status === 400 || error.status === 409)) {
				idempotencyKey.current = crypto.randomUUID()
				setFormError(error.message)
				return
			}
			toastApiError(error)
		},
	})

	const postMutation = useMutation({
		mutationFn: () => postReturn(created?.supplierReturn.id as string),
		onSuccess: async (data) => {
			toast.success(
				data.creditNote
					? `Return posted — credit note ${data.creditNote.number} for ${formatGhs(data.creditNote.amountMinor)}`
					: "Return posted",
			)
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: returnKeys.all }),
				queryClient.invalidateQueries({ queryKey: orderKeys.byId(order.order.id) }),
				queryClient.invalidateQueries({ queryKey: orderKeys.all }),
				queryClient.invalidateQueries({ queryKey: inventoryKeys.stock }),
				queryClient.invalidateQueries({ queryKey: inventoryKeys.movements }),
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

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		setFormError(null)
		if (!receipt) {
			setFormError("Choose the goods receipt these items came from.")
			return
		}
		if (proposedQuantity === 0) {
			setFormError("Enter the quantity to return on at least one line.")
			return
		}
		for (const row of rows) {
			const quantity = parseQuantity(row.quantity)
			if (quantity > row.received) {
				setFormError(`You can return at most ${row.received} of ${row.sku}; the API refuses more.`)
				return
			}
		}
		if (reason.trim().length < 3) {
			setFormError("Enter a reason of at least three characters.")
			return
		}
		createMutation.mutate()
	}

	const busy = createMutation.isPending || postMutation.isPending

	return (
		<Dialog
			open
			onOpenChange={(next) => {
				if (!next) onClose()
			}}
		>
			<DialogContent className="sm:max-w-3xl">
				<DialogHeader>
					<DialogTitle>Return goods to {order.order.supplierName}</DialogTitle>
					<DialogDescription>
						{created
							? "The draft posts nothing yet. Confirm below to move stock and create the credit note."
							: "Pick the receipt the goods came from. A return starts as a draft and only moves stock when it is posted."}
					</DialogDescription>
				</DialogHeader>

				{created ? (
					<div className="grid gap-4">
						<div className="grid gap-1 rounded-md border bg-muted/40 p-3 text-sm">
							<p>
								Draft return{" "}
								<span className="font-mono font-medium">{created.supplierReturn.number}</span>{" "}
								created.
							</p>
							<p className="text-muted-foreground">
								Credit value {formatGhs(created.totalCreditMinor)} across {created.lines.length}{" "}
								line{created.lines.length === 1 ? "" : "s"}. Stock has not moved yet.
							</p>
						</div>

						{formError ? (
							<p role="alert" className="text-sm text-destructive">
								{formError}
							</p>
						) : null}

						<DialogFooter>
							<Button type="button" variant="outline" onClick={onClose} disabled={busy}>
								Keep as draft
							</Button>
							<Button
								type="button"
								disabled={busy}
								onClick={() => {
									setFormError(null)
									postMutation.mutate()
								}}
							>
								{postMutation.isPending ? "Posting…" : "Post return and create credit note"}
							</Button>
						</DialogFooter>
					</div>
				) : (
					<form onSubmit={handleSubmit} className="grid gap-4">
						<div className="grid gap-1.5">
							<Label htmlFor="return-receipt">Goods receipt</Label>
							<Select
								value={receiptId || undefined}
								onValueChange={(value) => {
									setReceiptId(value)
									setFormError(null)
								}}
								disabled={busy}
							>
								<SelectTrigger id="return-receipt" className="w-full">
									<SelectValue
										placeholder={receiptsQuery.isLoading ? "Loading receipts…" : "Choose a receipt"}
									/>
								</SelectTrigger>
								<SelectContent>
									{receiptOptions.length === 0 ? (
										<SelectItem value="none" disabled>
											No receipts for this order yet
										</SelectItem>
									) : (
										receiptOptions.map((option) => (
											<SelectItem key={option.id} value={option.id}>
												{option.number} · {option.supplierInvoiceNumber ?? "no invoice #"} ·{" "}
												{formatGhs(option.totalCostMinor)}
											</SelectItem>
										))
									)}
								</SelectContent>
							</Select>
							<p className="text-xs text-muted-foreground">
								The deliveries recorded against this order. Each line is capped at what was received
								and not already returned.
							</p>
						</div>

						{returnableQuery.isLoading ? (
							<p className="text-sm text-muted-foreground">Loading receipt lines…</p>
						) : returnableQuery.isError ? (
							<p role="alert" className="text-sm text-destructive">
								Couldn't load that receipt.
							</p>
						) : receipt ? (
							<div className="grid gap-2">
								{rows.length === 0 ? (
									<p className="text-sm text-muted-foreground">
										That receipt has no lines to return.
									</p>
								) : (
									rows.map((row, index) => (
										<div
											key={row.receiptLineId}
											className="grid items-start gap-2 rounded-md border p-2 sm:grid-cols-[minmax(0,1fr)_70px_70px_90px_90px_90px]"
										>
											<div className="min-w-0">
												<p className="truncate text-sm font-medium">{row.name}</p>
												<p className="font-mono text-xs text-muted-foreground">{row.sku}</p>
											</div>
											<div className="grid gap-1">
												<span className="text-xs text-muted-foreground">Received</span>
												<span className="py-2 text-sm tabular-nums">{row.received}</span>
											</div>
											<div className="grid gap-1">
												<span className="text-xs text-muted-foreground">Returned</span>
												<span className="py-2 text-sm tabular-nums">{row.returned}</span>
											</div>
											<div className="grid gap-1">
												<Label className="text-xs" htmlFor={`return-qty-${row.receiptLineId}`}>
													Return now
												</Label>
												<Input
													id={`return-qty-${row.receiptLineId}`}
													inputMode="numeric"
													placeholder="0"
													max={row.returnable}
													value={row.quantity}
													disabled={busy || row.returnable === 0}
													onChange={(event) =>
														setRows((current) =>
															current.map((item) =>
																item.receiptLineId === row.receiptLineId
																	? { ...item, quantity: event.target.value }
																	: item,
															),
														)
													}
													aria-label={`Quantity to return for line ${index + 1}`}
												/>
											</div>
											<div className="grid gap-1">
												<span className="text-xs text-muted-foreground">Can still return</span>
												<span className="py-2 text-sm tabular-nums">{row.returnable}</span>
											</div>
											<div className="grid gap-1">
												<span className="text-xs text-muted-foreground">Unit cost</span>
												<span className="py-2 text-sm tabular-nums">
													{formatGhs(row.unitCostMinor)}
												</span>
											</div>
										</div>
									))
								)}
							</div>
						) : (
							<p className="text-sm text-muted-foreground">
								Choose a receipt to see its returnable lines.
							</p>
						)}

						<div className="grid gap-3 sm:grid-cols-2">
							<div className="grid gap-1.5">
								<Label htmlFor="return-reason">Reason (required)</Label>
								<Textarea
									id="return-reason"
									rows={2}
									maxLength={300}
									value={reason}
									disabled={busy}
									onChange={(event) => setReason(event.target.value)}
								/>
							</div>
							<div className="grid gap-3">
								<div className="grid gap-1.5">
									<Label htmlFor="return-credit-note">Supplier credit note number (optional)</Label>
									<Input
										id="return-credit-note"
										maxLength={60}
										value={supplierCreditNoteNumber}
										disabled={busy}
										onChange={(event) => setSupplierCreditNoteNumber(event.target.value)}
									/>
								</div>
								<div className="grid gap-1.5">
									<Label htmlFor="return-note">Note (optional)</Label>
									<Textarea
										id="return-note"
										rows={2}
										maxLength={300}
										value={note}
										disabled={busy}
										onChange={(event) => setNote(event.target.value)}
									/>
								</div>
							</div>
						</div>

						<p className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
							Credit value at the receipt cost:{" "}
							<span className="font-medium tabular-nums">{formatGhs(creditPreviewMinor)}</span> for{" "}
							{proposedQuantity} unit{proposedQuantity === 1 ? "" : "s"}.
						</p>

						{formError ? (
							<p role="alert" className="text-sm text-destructive">
								{formError}
							</p>
						) : null}

						<DialogFooter>
							<Button type="button" variant="outline" onClick={onClose} disabled={busy}>
								Cancel
							</Button>
							<Button type="submit" disabled={busy || !receipt}>
								{busy ? "Saving…" : "Create draft return"}
							</Button>
						</DialogFooter>
					</form>
				)}
			</DialogContent>
		</Dialog>
	)
}
