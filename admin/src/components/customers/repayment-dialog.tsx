import { useMutation, useQueryClient } from "@tanstack/react-query"
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
import { ApiError, api } from "#/lib/api"
import type { CreditMethod } from "#/lib/api-types"
import { CREDIT_METHOD_LABELS } from "#/lib/credit"
import { formatGhs, parseGhsToMinor } from "#/lib/format"
import { toastApiError } from "#/lib/toast"

const METHODS: CreditMethod[] = ["CASH", "MOMO", "BANK"]

export function RepaymentDialog({
	open,
	onOpenChange,
	customerId,
	branchId,
	branchName,
	currentBalanceMinor,
	receivedBy,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	customerId: string
	branchId: string | null
	branchName: string | null
	currentBalanceMinor: number | null
	receivedBy: string
}) {
	const queryClient = useQueryClient()

	const [amount, setAmount] = useState("")
	const [method, setMethod] = useState<CreditMethod>("CASH")
	const [note, setNote] = useState("")
	const [formError, setFormError] = useState<string | null>(null)

	// One key per form session: a network failure retries the same posting
	// (the server replays it), while a server response resets the key.
	const idempotencyKey = useRef<string | null>(null)

	function takeIdempotencyKey(): string {
		idempotencyKey.current ??= crypto.randomUUID()
		return idempotencyKey.current
	}

	useEffect(() => {
		if (!open) return
		setAmount("")
		setMethod("CASH")
		setNote("")
		setFormError(null)
		idempotencyKey.current = null
	}, [open])

	const payMutation = useMutation({
		mutationFn: (input: { amountMinor: number; method: CreditMethod; note?: string }) =>
			api.credit.repayments.create({
				customerId,
				branchId: branchId ?? undefined,
				...input,
				idempotencyKey: takeIdempotencyKey(),
			}),
		onSuccess: async (data) => {
			toast.success(`Repayment recorded — receipt ${data.entry.referenceNumber}`)
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ["credit-entries"] }),
				queryClient.invalidateQueries({ queryKey: ["credit-profiles", customerId] }),
				queryClient.invalidateQueries({ queryKey: ["customer", customerId] }),
				queryClient.invalidateQueries({ queryKey: ["aging"] }),
			])
			onOpenChange(false)
		},
		onError: (error) => {
			if (error instanceof ApiError) {
				idempotencyKey.current = null
				if (error.status === 400 || error.status === 403 || error.status === 409) {
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

		const amountMinor = parseGhsToMinor(amount)
		if (amountMinor === null || amountMinor < 1) {
			setFormError("Enter the amount in GHS, for example 50 or 50.50.")
			return
		}
		if (method !== "CASH" && note.trim() === "") {
			setFormError("Add the MoMo/Bank transaction reference to the note.")
			return
		}

		payMutation.mutate({ amountMinor, method, note: note.trim() || undefined })
	}

	const parsedAmount = parseGhsToMinor(amount)
	const settledBalance = Math.max(currentBalanceMinor ?? 0, 0)
	const leftoverCredit =
		parsedAmount !== null && parsedAmount > settledBalance ? parsedAmount - settledBalance : null

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Record repayment</DialogTitle>
					<DialogDescription>
						{branchName
							? `Posts a collection to the ${branchName} ledger and issues a receipt number.`
							: "Posts a collection to the ledger and issues a receipt number."}
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="grid gap-4">
					<div className="grid gap-1.5">
						<Label htmlFor="repayment-amount">Amount (GHS)</Label>
						<Input
							id="repayment-amount"
							required
							inputMode="decimal"
							value={amount}
							onChange={(event) => setAmount(event.target.value)}
						/>
						{currentBalanceMinor !== null ? (
							<p className="text-xs text-muted-foreground">
								Current balance: {formatGhs(Math.max(currentBalanceMinor, 0))}
								{currentBalanceMinor < 0 ? " (customer credit)" : ""}
							</p>
						) : null}
						{leftoverCredit !== null ? (
							<p className="text-xs text-amber-700">
								This is more than the balance — {formatGhs(leftoverCredit)} stays as customer
								credit.
							</p>
						) : null}
					</div>

					<div className="grid gap-1.5">
						<Label htmlFor="repayment-method">Method</Label>
						<Select value={method} onValueChange={(value) => setMethod(value as CreditMethod)}>
							<SelectTrigger id="repayment-method" className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{METHODS.map((value) => (
									<SelectItem key={value} value={value}>
										{CREDIT_METHOD_LABELS[value]}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					<div className="grid gap-1.5">
						<Label htmlFor="repayment-note">
							Reference / note{" "}
							{method === "CASH" ? (
								<span className="font-normal text-muted-foreground">(optional)</span>
							) : null}
						</Label>
						<Textarea
							id="repayment-note"
							rows={2}
							maxLength={300}
							placeholder={
								method === "CASH" ? "Anything worth remembering" : "MoMo/bank transaction reference"
							}
							value={note}
							onChange={(event) => setNote(event.target.value)}
						/>
						{method !== "CASH" ? (
							<p className="text-xs text-muted-foreground">
								{CREDIT_METHOD_LABELS[method]} payments need their transaction reference here.
							</p>
						) : null}
					</div>

					<p className="text-xs text-muted-foreground">
						Received by <span className="font-medium text-foreground">{receivedBy}</span> — recorded
						on the entry.
					</p>

					{formError ? (
						<p role="alert" className="text-sm text-destructive">
							{formError}
						</p>
					) : null}

					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							Cancel
						</Button>
						<Button type="submit" disabled={payMutation.isPending || branchId === null}>
							{payMutation.isPending ? "Recording…" : "Record repayment"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
