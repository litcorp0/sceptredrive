import { useMutation, useQueryClient } from "@tanstack/react-query"
import { type FormEvent, useEffect, useState } from "react"
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
import { Label } from "#/components/ui/label"
import { Textarea } from "#/components/ui/textarea"
import { ApiError } from "#/lib/api"
import { toastApiError } from "#/lib/toast"
import { transferKeys } from "../api/keys"
import { replaceTransferLines, updateTransfer } from "../api/transfers"
import type { Transfer } from "../types"
import {
	newTransferLine,
	type TransferLineDraft,
	TransferLinesEditor,
} from "./transfer-lines-editor"

export function EditTransferDialog({
	open,
	onOpenChange,
	transfer,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	transfer: Transfer
}) {
	const queryClient = useQueryClient()
	const [rows, setRows] = useState<TransferLineDraft[]>([newTransferLine()])
	const [note, setNote] = useState("")
	const [formError, setFormError] = useState<string | null>(null)

	useEffect(() => {
		if (!open) return
		setRows(
			(transfer.lines ?? []).map((line) => ({
				key: crypto.randomUUID(),
				product: {
					id: line.productId,
					sku: line.sku,
					name: line.productName,
					costPriceMinor: line.unitCostMinor,
				},
				quantity: String(line.quantityRequested),
			})),
		)
		setNote(transfer.note ?? "")
		setFormError(null)
	}, [open, transfer])

	const mutation = useMutation({
		mutationFn: async () => {
			const lines = []
			for (const row of rows) {
				if (!row.product) throw new Error("Choose a product for every line.")
				const quantity = Number.parseInt(row.quantity, 10)
				if (!Number.isSafeInteger(quantity) || quantity <= 0) {
					throw new Error(`Enter a whole quantity for ${row.product.name}.`)
				}
				lines.push({ productId: row.product.id, quantityRequested: quantity })
			}
			if (new Set(lines.map((line) => line.productId)).size !== lines.length) {
				throw new Error("Each product may appear only once.")
			}

			const nextNote = note.trim() ? note.trim() : null
			if (nextNote !== (transfer.note ?? null)) {
				await updateTransfer(transfer.id, { note: nextNote })
			}
			return replaceTransferLines(transfer.id, lines)
		},
		onSuccess: async () => {
			toast.success("Transfer updated")
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: transferKeys.all }),
				queryClient.invalidateQueries({ queryKey: transferKeys.detail(transfer.id) }),
			])
			onOpenChange(false)
		},
		onError: (error) => {
			if (error instanceof ApiError) {
				if (error.status === 409 || error.status === 400) {
					setFormError(error.message)
					return
				}
				toastApiError(error)
				return
			}
			setFormError(error.message)
		},
	})

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		setFormError(null)
		mutation.mutate()
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>Edit transfer {transfer.number}</DialogTitle>
					<DialogDescription>
						Draft quantities and lines stay editable until the transfer is dispatched.
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="grid gap-4">
					<TransferLinesEditor rows={rows} onChange={setRows} disabled={mutation.isPending} />

					<div className="grid gap-1.5">
						<Label htmlFor="transfer-edit-note">Note</Label>
						<Textarea
							id="transfer-edit-note"
							value={note}
							onChange={(event) => setNote(event.target.value)}
							maxLength={300}
							rows={2}
						/>
					</div>

					{formError ? (
						<p role="alert" className="text-sm text-destructive">
							{formError}
						</p>
					) : null}

					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							Cancel
						</Button>
						<Button type="submit" disabled={mutation.isPending}>
							{mutation.isPending ? "Saving…" : "Save changes"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
