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
import { ApiError, api } from "#/lib/api"
import type { Transfer } from "#/lib/api-types"
import { toastApiError } from "#/lib/toast"

export function ShortCloseDialog({
	open,
	onOpenChange,
	transfer,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	transfer: Transfer
}) {
	const queryClient = useQueryClient()
	const [note, setNote] = useState("")
	const [formError, setFormError] = useState<string | null>(null)

	useEffect(() => {
		if (!open) return
		setNote("")
		setFormError(null)
	}, [open])

	const pendingLines = (transfer.lines ?? []).filter((line) => line.pending > 0)

	const mutation = useMutation({
		mutationFn: (value: string) => api.transfers.shortClose(transfer.id, value),
		onSuccess: async () => {
			toast.success("Transfer short-closed")
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ["transfers"] }),
				queryClient.invalidateQueries({ queryKey: ["transfer", transfer.id] }),
			])
			onOpenChange(false)
		},
		onError: (error) => {
			if (error instanceof ApiError && (error.status === 409 || error.status === 400)) {
				setFormError(error.message)
				return
			}
			toastApiError(error)
		},
	})

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		setFormError(null)
		if (!note.trim()) {
			setFormError("Record why the remaining quantity will not arrive.")
			return
		}
		mutation.mutate(note.trim())
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Close short</DialogTitle>
					<DialogDescription>
						The remaining quantity will not be received. It is recorded as a discrepancy; no extra
						movement is posted because the stock already left the source.
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="grid gap-4">
					<div className="rounded-md border p-3">
						<p className="mb-1 text-xs font-medium text-muted-foreground">Pending shortfall</p>
						<ul className="grid gap-1 text-sm">
							{pendingLines.map((line) => (
								<li key={line.productId} className="flex justify-between gap-2">
									<span className="truncate">{line.productName}</span>
									<span className="font-medium tabular-nums">{line.pending}</span>
								</li>
							))}
						</ul>
					</div>

					<div className="grid gap-1.5">
						<Label htmlFor="short-close-note">Reason</Label>
						<Textarea
							id="short-close-note"
							value={note}
							onChange={(event) => setNote(event.target.value)}
							maxLength={300}
							rows={3}
							placeholder="e.g. Two units missing from the carton on arrival"
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
							{mutation.isPending ? "Closing…" : "Close short"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
