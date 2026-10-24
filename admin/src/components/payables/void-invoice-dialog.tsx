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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select"
import { ApiError } from "#/lib/api"
import { toastApiError } from "#/lib/toast"
import {
	payablesKeys,
	type SupplierInvoiceRow,
	type SupplierInvoiceVoidReason,
	voidInvoice,
} from "#/modules/payables"
import { supplierKeys } from "#/modules/suppliers"

const VOID_REASONS: Array<{ value: SupplierInvoiceVoidReason; label: string }> = [
	{ value: "DUPLICATE", label: "Duplicate invoice" },
	{ value: "CANCELLED", label: "Cancelled by the supplier" },
	{ value: "ERROR", label: "Recorded in error" },
	{ value: "OTHER", label: "Other" },
]

export function VoidInvoiceDialog({
	open,
	onOpenChange,
	invoice,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	invoice: SupplierInvoiceRow & { outstandingMinor: number }
}) {
	const queryClient = useQueryClient()
	const [reason, setReason] = useState<SupplierInvoiceVoidReason>("DUPLICATE")
	const [formError, setFormError] = useState<string | null>(null)

	useEffect(() => {
		if (!open) return
		setReason("DUPLICATE")
		setFormError(null)
	}, [open])

	const voidMutation = useMutation({
		mutationFn: () => voidInvoice(invoice.id, { reason }),
		onSuccess: async () => {
			toast.success(`Invoice ${invoice.number} voided`)
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: payablesKeys.invoiceDetail(invoice.id) }),
				queryClient.invalidateQueries({ queryKey: payablesKeys.invoices }),
				queryClient.invalidateQueries({ queryKey: supplierKeys.byId(invoice.supplierId) }),
			])
			onOpenChange(false)
		},
		onError: (error) => {
			if (
				error instanceof ApiError &&
				(error.status === 400 || error.status === 404 || error.status === 409)
			) {
				setFormError(error.message)
				return
			}
			toastApiError(error)
		},
	})

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		setFormError(null)
		voidMutation.mutate()
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Void invoice {invoice.number}?</DialogTitle>
					<DialogDescription>
						Voiding keeps the record and its number as history. It is only allowed when no payment
						is allocated to the invoice; void the payment first if one is.
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="grid gap-4">
					<div className="grid gap-1.5">
						<Label htmlFor="invoice-void-reason">Reason</Label>
						<Select
							value={reason}
							onValueChange={(value) => setReason(value as SupplierInvoiceVoidReason)}
						>
							<SelectTrigger id="invoice-void-reason" className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{VOID_REASONS.map((option) => (
									<SelectItem key={option.value} value={option.value}>
										{option.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
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
						<Button type="submit" variant="destructive" disabled={voidMutation.isPending}>
							{voidMutation.isPending ? "Voiding…" : "Void invoice"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
