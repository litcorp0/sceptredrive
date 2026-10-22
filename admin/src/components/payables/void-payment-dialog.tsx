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
import { ApiError, api } from "#/lib/api"
import type { SupplierPaymentDetail, SupplierPaymentVoidReason } from "#/lib/api-types"
import { formatGhs } from "#/lib/format"
import { toastApiError } from "#/lib/toast"

const VOID_REASONS: Array<{ value: SupplierPaymentVoidReason; label: string }> = [
	{ value: "DUPLICATE", label: "Duplicate payment" },
	{ value: "ERROR", label: "Recorded in error" },
	{ value: "RETURNED", label: "Returned by the bank or MoMo" },
	{ value: "BANK_REVERSAL", label: "Bank reversal" },
	{ value: "OTHER", label: "Other" },
]

export function VoidPaymentDialog({
	open,
	onOpenChange,
	payment,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	payment: SupplierPaymentDetail
}) {
	const queryClient = useQueryClient()
	const [reason, setReason] = useState<SupplierPaymentVoidReason>("DUPLICATE")
	const [formError, setFormError] = useState<string | null>(null)

	useEffect(() => {
		if (!open) return
		setReason("DUPLICATE")
		setFormError(null)
	}, [open])

	const netByInvoice = new Map<string, { number: string; net: number }>()
	for (const allocation of payment.allocations) {
		const entry = netByInvoice.get(allocation.invoiceId) ?? {
			number: allocation.invoiceNumber,
			net: 0,
		}
		entry.net += allocation.amountMinor
		netByInvoice.set(allocation.invoiceId, entry)
	}
	const releases = [...netByInvoice.values()].filter((row) => row.net > 0)

	const voidMutation = useMutation({
		mutationFn: () => api.payables.payments.void(payment.payment.id, { reason }),
		onSuccess: async () => {
			toast.success(`Payment ${payment.payment.number} voided`)
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ["supplier-payment", payment.payment.id] }),
				queryClient.invalidateQueries({ queryKey: ["supplier-payments"] }),
				queryClient.invalidateQueries({ queryKey: ["supplier-invoices"] }),
				queryClient.invalidateQueries({ queryKey: ["supplier-invoice"] }),
				queryClient.invalidateQueries({ queryKey: ["payment-outstanding"] }),
				queryClient.invalidateQueries({
					queryKey: ["supplier", payment.payment.supplierId],
				}),
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
					<DialogTitle>Void payment {payment.payment.number}?</DialogTitle>
					<DialogDescription>
						Voiding writes release entries and flips every invoice this payment covers back to its
						unpaid state. The payment and its history stay visible.
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="grid gap-4">
					{releases.length > 0 ? (
						<div className="rounded-md border bg-muted/40 p-3 text-sm">
							<p className="font-medium">Releases to write</p>
							<ul className="mt-1 grid gap-0.5 text-muted-foreground">
								{releases.map((release) => (
									<li key={release.number} className="flex justify-between gap-3">
										<span className="font-mono text-xs">{release.number}</span>
										<span className="tabular-nums">−{formatGhs(release.net)}</span>
									</li>
								))}
							</ul>
						</div>
					) : (
						<p className="text-sm text-muted-foreground">
							This payment has no net invoice allocations left; the remainder sits on account.
						</p>
					)}

					<div className="grid gap-1.5">
						<Label htmlFor="payment-void-reason">Reason</Label>
						<Select
							value={reason}
							onValueChange={(value) => setReason(value as SupplierPaymentVoidReason)}
						>
							<SelectTrigger id="payment-void-reason" className="w-full">
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
							{voidMutation.isPending ? "Voiding…" : "Void payment"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
