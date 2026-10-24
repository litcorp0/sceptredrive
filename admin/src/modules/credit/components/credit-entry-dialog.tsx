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
import { ApiError } from "#/lib/api"
import { formatGhs, parseGhsToMinor } from "#/lib/format"
import { toastApiError } from "#/lib/toast"
import { createCreditEntry } from "../api/credit"
import { creditKeys } from "../api/keys"
import type { CreditOverrideReason, CreditReasonCode } from "../types"
import {
	CREDIT_KIND_LABELS,
	CREDIT_OVERRIDE_LABELS,
	CREDIT_REASON_LABELS,
	signedGhs,
} from "../utils/credit"

type EntryKind = "CHARGE" | "REFUND" | "ADJUSTMENT"

/** Manual charges are onboarding/corrections; SALE belongs to the POS. */
const CHARGE_REASONS: CreditReasonCode[] = ["OPENING_BALANCE", "CORRECTION", "OTHER"]
const ADJUSTMENT_REASONS: CreditReasonCode[] = ["CORRECTION", "WRITE_OFF", "DISPUTE", "OTHER"]
const OVERRIDE_REASONS: CreditOverrideReason[] = [
	"TEMPORARY_APPROVAL",
	"TRUSTED_CUSTOMER",
	"URGENT_NEED",
	"OTHER",
]

const KIND_HINTS: Record<EntryKind, string> = {
	CHARGE: "Adds to what the customer owes.",
	REFUND: "Takes a returned sale off the balance (stored as a credit).",
	ADJUSTMENT: "Corrects the balance in either direction, with a reason.",
}

export function CreditEntryDialog({
	open,
	onOpenChange,
	customerId,
	branchId,
	branchName,
	currentBalanceMinor,
	limitMinor,
	canOverride,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	customerId: string
	branchId: string | null
	branchName: string | null
	currentBalanceMinor: number | null
	limitMinor: number | null
	canOverride: boolean
}) {
	const queryClient = useQueryClient()

	const [kind, setKind] = useState<EntryKind>("CHARGE")
	const [amount, setAmount] = useState("")
	const [direction, setDirection] = useState<"increase" | "reduce">("increase")
	const [reasonCode, setReasonCode] = useState("")
	const [reference, setReference] = useState("")
	const [note, setNote] = useState("")
	const [formError, setFormError] = useState<string | null>(null)
	const [overrideVisible, setOverrideVisible] = useState(false)
	const [overrideReason, setOverrideReason] = useState("")
	const [overrideNote, setOverrideNote] = useState("")

	// One key per form session: a network failure retries the same posting
	// (the server replays it), while a server response resets the key.
	const idempotencyKey = useRef<string | null>(null)

	function takeIdempotencyKey(): string {
		idempotencyKey.current ??= crypto.randomUUID()
		return idempotencyKey.current
	}

	useEffect(() => {
		if (!open) return
		setKind("CHARGE")
		setAmount("")
		setDirection("increase")
		setReasonCode("")
		setReference("")
		setNote("")
		setFormError(null)
		setOverrideVisible(false)
		setOverrideReason("")
		setOverrideNote("")
		idempotencyKey.current = null
	}, [open])

	const postMutation = useMutation({
		mutationFn: (input: {
			amountMinor: number
			reasonCode: CreditReasonCode
			referenceNumber?: string
			note?: string
			override?: { reasonCode: CreditOverrideReason; note?: string }
		}) =>
			createCreditEntry({
				customerId,
				branchId: branchId ?? undefined,
				kind,
				...input,
				idempotencyKey: takeIdempotencyKey(),
			}),
		onSuccess: async (data) => {
			toast.success(
				`${CREDIT_KIND_LABELS[data.entry.kind]} recorded — ${signedGhs(data.entry.amountMinor)}`,
			)
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: creditKeys.entries }),
				queryClient.invalidateQueries({ queryKey: creditKeys.profileList(customerId) }),
				// The customers profile key, still owned by the customer route; Plan 09 moves it
				// behind `#/modules/customers` and this invalidation imports it from there.
				queryClient.invalidateQueries({ queryKey: ["customer", customerId] }),
				queryClient.invalidateQueries({ queryKey: creditKeys.aging }),
			])
			onOpenChange(false)
		},
		onError: (error) => {
			if (error instanceof ApiError) {
				idempotencyKey.current = null
				if (error.status === 409 && /exceeds the credit limit/i.test(error.message)) {
					setFormError(error.message)
					if (canOverride) setOverrideVisible(true)
					return
				}
				if (error.status === 400 || error.status === 403 || error.status === 409) {
					setFormError(error.message)
					return
				}
			}
			toastApiError(error)
		},
	})

	function changeKind(value: EntryKind) {
		setKind(value)
		setReasonCode("")
		setFormError(null)
		setOverrideVisible(false)
		setOverrideReason("")
		setOverrideNote("")
	}

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		setFormError(null)

		const parsed = parseGhsToMinor(amount)
		if (parsed === null || parsed < 1) {
			setFormError("Enter the amount in GHS, for example 100 or 100.50.")
			return
		}
		if (kind !== "REFUND" && reasonCode === "") {
			setFormError(
				kind === "CHARGE"
					? "Choose a reason for the charge."
					: "Choose a reason for the adjustment.",
			)
			return
		}
		if (overrideVisible && overrideReason === "") {
			setFormError("Choose an override reason to post this charge over the limit.")
			return
		}

		postMutation.mutate({
			amountMinor: kind === "ADJUSTMENT" && direction === "reduce" ? -parsed : parsed,
			reasonCode: kind === "REFUND" ? "RETURN" : (reasonCode as CreditReasonCode),
			referenceNumber: reference.trim() || undefined,
			note: note.trim() || undefined,
			override: overrideVisible
				? {
						reasonCode: overrideReason as CreditOverrideReason,
						note: overrideNote.trim() || undefined,
					}
				: undefined,
		})
	}

	const parsedAmount = parseGhsToMinor(amount)
	const headroom =
		limitMinor !== null && currentBalanceMinor !== null ? limitMinor - currentBalanceMinor : null
	const overHeadroom =
		kind === "CHARGE" && parsedAmount !== null && headroom !== null && parsedAmount > headroom
	const reasonOptions = kind === "CHARGE" ? CHARGE_REASONS : ADJUSTMENT_REASONS

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>New credit entry</DialogTitle>
					<DialogDescription>
						{branchName
							? `Posts directly to the ${branchName} ledger.`
							: "Posts directly to the ledger."}
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="grid gap-4">
					<div className="grid gap-1.5">
						<Label htmlFor="entry-kind">Kind</Label>
						<Select value={kind} onValueChange={(value) => changeKind(value as EntryKind)}>
							<SelectTrigger id="entry-kind" className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="CHARGE">Charge</SelectItem>
								<SelectItem value="REFUND">Refund</SelectItem>
								<SelectItem value="ADJUSTMENT">Adjustment</SelectItem>
							</SelectContent>
						</Select>
						<p className="text-xs text-muted-foreground">{KIND_HINTS[kind]}</p>
					</div>

					<div className="grid gap-1.5">
						<Label htmlFor="entry-amount">Amount (GHS)</Label>
						<Input
							id="entry-amount"
							required
							inputMode="decimal"
							value={amount}
							onChange={(event) => setAmount(event.target.value)}
						/>
						{overHeadroom && parsedAmount !== null ? (
							<p className="text-xs text-amber-700">
								This goes {formatGhs(parsedAmount - (headroom ?? 0))} over the remaining headroom —{" "}
								{canOverride ? "you'll be asked to confirm an override." : "it will be rejected."}
							</p>
						) : null}
					</div>

					{kind === "ADJUSTMENT" ? (
						<div className="grid gap-1.5">
							<Label htmlFor="entry-direction">Direction</Label>
							<Select
								value={direction}
								onValueChange={(value) => setDirection(value as "increase" | "reduce")}
							>
								<SelectTrigger id="entry-direction" className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="increase">Increase what the customer owes</SelectItem>
									<SelectItem value="reduce">Reduce what the customer owes</SelectItem>
								</SelectContent>
							</Select>
						</div>
					) : null}

					{kind === "REFUND" ? (
						<p className="text-sm text-muted-foreground">
							Reason: <span className="font-medium text-foreground">Return</span>
						</p>
					) : (
						<div className="grid gap-1.5">
							<Label htmlFor="entry-reason">Reason</Label>
							<Select value={reasonCode} onValueChange={setReasonCode}>
								<SelectTrigger id="entry-reason" className="w-full">
									<SelectValue placeholder="Choose a reason" />
								</SelectTrigger>
								<SelectContent>
									{reasonOptions.map((value) => (
										<SelectItem key={value} value={value}>
											{CREDIT_REASON_LABELS[value]}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					)}

					<div className="grid gap-1.5">
						<Label htmlFor="entry-reference">
							Reference <span className="font-normal text-muted-foreground">(optional)</span>
						</Label>
						<Input
							id="entry-reference"
							maxLength={60}
							placeholder="Invoice or document number"
							value={reference}
							onChange={(event) => setReference(event.target.value)}
						/>
					</div>

					<div className="grid gap-1.5">
						<Label htmlFor="entry-note">
							Note <span className="font-normal text-muted-foreground">(optional)</span>
						</Label>
						<Textarea
							id="entry-note"
							rows={2}
							maxLength={300}
							value={note}
							onChange={(event) => setNote(event.target.value)}
						/>
					</div>

					{formError ? (
						<p role="alert" className="text-sm text-destructive">
							{formError}
						</p>
					) : null}

					{overrideVisible ? (
						<div className="grid gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
							<div>
								<p className="text-sm font-medium text-amber-900">Over the credit limit</p>
								<p className="text-xs text-amber-800">
									Posting anyway records an override with your name on the entry.
								</p>
							</div>
							<div className="grid gap-1.5">
								<Label htmlFor="override-reason">Override reason</Label>
								<Select value={overrideReason} onValueChange={setOverrideReason}>
									<SelectTrigger id="override-reason" className="w-full">
										<SelectValue placeholder="Choose an override reason" />
									</SelectTrigger>
									<SelectContent>
										{OVERRIDE_REASONS.map((value) => (
											<SelectItem key={value} value={value}>
												{CREDIT_OVERRIDE_LABELS[value]}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							<div className="grid gap-1.5">
								<Label htmlFor="override-note">
									Override note{" "}
									<span className="font-normal text-muted-foreground">(optional)</span>
								</Label>
								<Input
									id="override-note"
									maxLength={300}
									value={overrideNote}
									onChange={(event) => setOverrideNote(event.target.value)}
								/>
							</div>
						</div>
					) : null}

					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							Cancel
						</Button>
						<Button type="submit" disabled={postMutation.isPending || branchId === null}>
							{postMutation.isPending ? "Posting…" : "Post entry"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
