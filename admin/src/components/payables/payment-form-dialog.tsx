import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { type FormEvent, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import {
	type AllocationDraft,
	AllocationEditor,
	allocationDraftInputs,
	allocationDraftsTotal,
} from "#/components/payables/allocation-editor"
import { type PickedSupplier, SupplierCombobox } from "#/components/suppliers/supplier-combobox"
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
import { ApiError, api } from "#/lib/api"
import type { PaymentCreateInput, SupplierPaymentMethod } from "#/lib/api-types"
import { useBranch } from "#/lib/branch-context"
import { formatGhs, formatMinorPlain, parseGhsToMinor } from "#/lib/format"
import { toastApiError } from "#/lib/toast"

export interface InvoicePaymentTarget {
	id: string
	number: string
	supplierInvoiceNumber: string
	supplierId: string
	supplierName: string
	branchId: string
	outstandingMinor: number
}

function localDateTimeInput(date: Date): string {
	const offset = date.getTimezoneOffset() * 60_000
	return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

export function PaymentFormDialog({
	open,
	onOpenChange,
	initialSupplier = null,
	invoice = null,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	initialSupplier?: PickedSupplier | null
	/** Pre-scope the payment to one invoice (from the invoice detail screen). */
	invoice?: InvoicePaymentTarget | null
}) {
	const queryClient = useQueryClient()
	const { branches, activeBranchId, activeBranch, canSelectBranch } = useBranch()

	const [supplier, setSupplier] = useState<PickedSupplier | null>(null)
	const [branchId, setBranchId] = useState("")
	const [method, setMethod] = useState<SupplierPaymentMethod>("CASH")
	const [amount, setAmount] = useState("")
	const [paidAt, setPaidAt] = useState("")
	const [reference, setReference] = useState("")
	const [note, setNote] = useState("")
	const [paymentDetailId, setPaymentDetailId] = useState("")
	const [allocations, setAllocations] = useState<AllocationDraft>({})
	const [formError, setFormError] = useState<string | null>(null)

	// One key per form session: a network failure retries the same posting
	// (the server replays it), while a server response resets the key.
	const idempotencyKey = useRef<string | null>(null)
	const wasOpen = useRef(false)

	function takeIdempotencyKey(): string {
		idempotencyKey.current ??= crypto.randomUUID()
		return idempotencyKey.current
	}

	useEffect(() => {
		if (!open) {
			wasOpen.current = false
			return
		}
		if (wasOpen.current) return
		wasOpen.current = true

		setSupplier(
			invoice
				? {
						id: invoice.supplierId,
						code: "",
						name: invoice.supplierName,
						paymentTermDays: 0,
					}
				: initialSupplier,
		)
		setBranchId(invoice?.branchId ?? activeBranchId ?? "")
		setMethod("CASH")
		setAmount(invoice ? formatMinorPlain(invoice.outstandingMinor) : "")
		setPaidAt(localDateTimeInput(new Date()))
		setReference("")
		setNote("")
		setPaymentDetailId("")
		setAllocations(invoice ? { [invoice.id]: formatMinorPlain(invoice.outstandingMinor) } : {})
		setFormError(null)
		idempotencyKey.current = null
	}, [open, invoice, initialSupplier, activeBranchId])

	useEffect(() => {
		if (!canSelectBranch) return
		if (branchId !== "") return
		setBranchId(activeBranchId ?? branches[0]?.id ?? "")
	}, [canSelectBranch, branchId, activeBranchId, branches])

	const supplierQuery = useQuery({
		queryKey: ["supplier", supplier?.id],
		queryFn: () => api.suppliers.get(supplier?.id as string),
		enabled: open && supplier !== null,
	})

	const paymentDetails = (supplierQuery.data?.paymentDetails ?? []).filter(
		(detail) => detail.isActive && detail.method === method,
	)

	const amountMinor = parseGhsToMinor(amount) ?? 0
	const allocatedMinor = allocationDraftsTotal(allocations)

	const saveMutation = useMutation({
		mutationFn: (input: PaymentCreateInput) => api.payables.payments.create(input),
		onSuccess: async (data) => {
			idempotencyKey.current = null
			toast.success(
				data.replayed
					? `Payment ${data.payment.payment.number} was already recorded`
					: `Payment ${data.payment.payment.number} recorded`,
			)
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ["supplier-payments"] }),
				queryClient.invalidateQueries({ queryKey: ["supplier-invoices"] }),
				queryClient.invalidateQueries({ queryKey: ["supplier-invoice"] }),
				queryClient.invalidateQueries({ queryKey: ["payment-outstanding"] }),
				queryClient.invalidateQueries({ queryKey: ["supplier", data.payment.payment.supplierId] }),
			])
			onOpenChange(false)
		},
		onError: (error) => {
			if (error instanceof ApiError) {
				idempotencyKey.current = null
				if (error.status === 400 || error.status === 409) {
					setFormError(error.message)
					return
				}
			}
			toastApiError(error)
		},
	})

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		setFormError(null)

		if (!supplier) {
			setFormError("Choose the supplier this payment belongs to.")
			return
		}
		if (canSelectBranch && !branchId) {
			setFormError("Choose the branch that owns this payment.")
			return
		}
		if (amountMinor <= 0) {
			setFormError("Enter a payment amount like 250.00.")
			return
		}
		const paidDate = new Date(paidAt)
		if (Number.isNaN(paidDate.getTime())) {
			setFormError("Enter a valid paid-at date and time.")
			return
		}
		if (paidDate.getTime() > Date.now() + 5 * 60_000) {
			setFormError("Paid-at cannot be in the future.")
			return
		}

		for (const value of Object.values(allocations)) {
			if (value.trim() === "") continue
			if (parseGhsToMinor(value) === null) {
				setFormError("Allocation amounts must look like 12.50.")
				return
			}
		}
		if (allocatedMinor > amountMinor) {
			setFormError("Allocations cannot exceed the payment amount.")
			return
		}

		const allocationInputs = allocationDraftInputs(allocations)

		saveMutation.mutate({
			supplierId: supplier.id,
			branchId: canSelectBranch ? branchId : undefined,
			method,
			amountMinor,
			paidAt: paidDate.toISOString(),
			reference: reference.trim() || undefined,
			note: note.trim() || undefined,
			paymentDetailId: paymentDetailId || undefined,
			allocations: allocationInputs.length > 0 ? allocationInputs : undefined,
			idempotencyKey: takeIdempotencyKey(),
		})
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>Record supplier payment</DialogTitle>
					<DialogDescription>
						Pay in full, part, or across several invoices. Anything not allocated stays on account
						against the supplier.
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="grid gap-4">
					{invoice ? (
						<div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
							<span className="font-mono font-medium">{invoice.number}</span>
							<span className="text-muted-foreground">
								{" "}
								· supplier invoice {invoice.supplierInvoiceNumber} · outstanding{" "}
								{formatGhs(invoice.outstandingMinor)}
							</span>
						</div>
					) : null}

					<div className="grid gap-4 sm:grid-cols-2">
						<div className="grid gap-1.5">
							<Label>Supplier</Label>
							{invoice ? (
								<p className="rounded-md border bg-muted/40 px-3 py-2 text-sm font-medium">
									{invoice.supplierName}
								</p>
							) : (
								<SupplierCombobox
									value={supplier}
									onSelect={(next) => {
										setSupplier(next)
										setPaymentDetailId("")
										setAllocations({})
									}}
								/>
							)}
						</div>

						{canSelectBranch ? (
							<div className="grid gap-1.5">
								<Label htmlFor="payment-branch">Branch</Label>
								<Select
									value={branchId}
									onValueChange={(value) => {
										setBranchId(value)
										setAllocations({})
									}}
								>
									<SelectTrigger id="payment-branch" className="w-full">
										<SelectValue placeholder="Select a branch" />
									</SelectTrigger>
									<SelectContent>
										{branches.map((branch) => (
											<SelectItem key={branch.id} value={branch.id}>
												{branch.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						) : (
							<div className="grid gap-1.5">
								<Label>Branch</Label>
								<p className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
									{activeBranch?.name ?? "Your branch"}
								</p>
							</div>
						)}
					</div>

					<div className="grid gap-4 sm:grid-cols-2">
						<div className="grid gap-1.5">
							<Label htmlFor="payment-amount">Amount</Label>
							<Input
								id="payment-amount"
								inputMode="decimal"
								placeholder="0.00"
								required
								value={amount}
								onChange={(event) => setAmount(event.target.value)}
							/>
							<p className="text-xs text-muted-foreground">GHS — allocations cannot exceed this.</p>
						</div>
						<div className="grid gap-1.5">
							<Label htmlFor="payment-paid-at">Paid at</Label>
							<Input
								id="payment-paid-at"
								type="datetime-local"
								required
								value={paidAt}
								onChange={(event) => setPaidAt(event.target.value)}
							/>
						</div>
					</div>

					<div className="grid gap-4 sm:grid-cols-2">
						<div className="grid gap-1.5">
							<Label htmlFor="payment-method">Method</Label>
							<Select
								value={method}
								onValueChange={(value) => {
									setMethod(value as SupplierPaymentMethod)
									setPaymentDetailId("")
								}}
							>
								<SelectTrigger id="payment-method" className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="CASH">Cash</SelectItem>
									<SelectItem value="BANK">Bank transfer</SelectItem>
									<SelectItem value="MOMO">Mobile money</SelectItem>
								</SelectContent>
							</Select>
						</div>

						<div className="grid gap-1.5">
							<Label htmlFor="payment-reference">
								Reference <span className="font-normal text-muted-foreground">(optional)</span>
							</Label>
							<Input
								id="payment-reference"
								maxLength={80}
								placeholder="Bank or MoMo reference"
								value={reference}
								onChange={(event) => setReference(event.target.value)}
							/>
						</div>
					</div>

					{method !== "CASH" && supplier ? (
						<div className="grid gap-1.5">
							<Label htmlFor="payment-detail">
								Payment detail <span className="font-normal text-muted-foreground">(optional)</span>
							</Label>
							<Select
								value={paymentDetailId || "none"}
								onValueChange={(value) => setPaymentDetailId(value === "none" ? "" : value)}
							>
								<SelectTrigger id="payment-detail" className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="none">No linked detail</SelectItem>
									{paymentDetails.map((detail) => (
										<SelectItem key={detail.id} value={detail.id}>
											{detail.label ?? detail.bankName ?? "Payment detail"} ·{" "}
											{detail.accountNumberMasked ?? detail.phone ?? ""}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							{paymentDetails.length === 0 ? (
								<p className="text-xs text-muted-foreground">
									This supplier has no active {method === "BANK" ? "bank" : "MoMo"} detail.
								</p>
							) : null}
						</div>
					) : null}

					<div className="grid gap-1.5">
						<Label>Allocations</Label>
						<AllocationEditor
							supplierId={supplier?.id ?? null}
							branchId={canSelectBranch ? branchId || null : (activeBranchId ?? null)}
							paymentAmountMinor={amountMinor}
							allocations={allocations}
							onChange={setAllocations}
						/>
					</div>

					<div className="grid gap-1.5">
						<Label htmlFor="payment-note">
							Note <span className="font-normal text-muted-foreground">(optional)</span>
						</Label>
						<Textarea
							id="payment-note"
							rows={2}
							maxLength={500}
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
						<Button type="submit" disabled={saveMutation.isPending}>
							{saveMutation.isPending ? "Recording…" : "Record payment"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
