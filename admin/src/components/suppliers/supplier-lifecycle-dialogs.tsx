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
import {
	archiveSupplier,
	reactivateSupplier,
	type Supplier,
	supplierKeys,
} from "#/modules/suppliers"

export function ArchiveSupplierDialog({
	open,
	onOpenChange,
	supplier,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	supplier: Supplier
}) {
	const queryClient = useQueryClient()
	const [note, setNote] = useState("")
	const [formError, setFormError] = useState<string | null>(null)

	useEffect(() => {
		if (!open) return
		setNote("")
		setFormError(null)
	}, [open])

	const archiveMutation = useMutation({
		mutationFn: () => archiveSupplier(supplier.id, note.trim() || undefined),
		onSuccess: async (data) => {
			toast.success(`Supplier ${data.supplier.name} archived`)
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: supplierKeys.all }),
				queryClient.invalidateQueries({ queryKey: supplierKeys.byId(supplier.id) }),
			])
			onOpenChange(false)
		},
		onError: (error) => {
			if (error instanceof ApiError && (error.status === 404 || error.status === 409)) {
				setFormError(error.message)
				return
			}
			toastApiError(error)
		},
	})

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		setFormError(null)
		archiveMutation.mutate()
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Archive {supplier.name}?</DialogTitle>
					<DialogDescription>
						Archiving blocks new invoices and payments. A supplier with an outstanding balance or
						money on account must be settled or voided first; existing documents stay readable.
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="grid gap-4">
					<div className="grid gap-1.5">
						<Label htmlFor="supplier-archive-note">
							Reason <span className="font-normal text-muted-foreground">(optional)</span>
						</Label>
						<Textarea
							id="supplier-archive-note"
							rows={2}
							maxLength={300}
							value={note}
							onChange={(event) => setNote(event.target.value)}
						/>
					</div>

					{formError ? (
						<div
							role="alert"
							className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
						>
							{formError}
						</div>
					) : null}

					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							Cancel
						</Button>
						<Button type="submit" disabled={archiveMutation.isPending}>
							{archiveMutation.isPending ? "Archiving…" : "Archive supplier"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}

export function ReactivateSupplierButton({ supplier }: { supplier: Supplier }) {
	const queryClient = useQueryClient()

	const reactivateMutation = useMutation({
		mutationFn: () => reactivateSupplier(supplier.id),
		onSuccess: async (data) => {
			toast.success(`Supplier ${data.supplier.name} reactivated`)
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: supplierKeys.all }),
				queryClient.invalidateQueries({ queryKey: supplierKeys.byId(supplier.id) }),
			])
		},
		onError: (error) => toastApiError(error),
	})

	return (
		<Button
			size="sm"
			variant="outline"
			disabled={reactivateMutation.isPending}
			onClick={() => reactivateMutation.mutate()}
		>
			{reactivateMutation.isPending ? "Reactivating…" : "Reactivate"}
		</Button>
	)
}
