import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { type FormEvent, useEffect, useState } from "react"
import { toast } from "sonner"
import { StatusNote } from "#/components/common/status-note"
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
import { Switch } from "#/components/ui/switch"
import { Textarea } from "#/components/ui/textarea"
import { ApiError } from "#/lib/api"
import { formatGhs, formatMinorPlain, parseGhsToMinor } from "#/lib/format"
import { toastApiError } from "#/lib/toast"
import { approvalKeys } from "#/modules/approvals"
import { updateCreditProfile, requestCreditLimitIncrease } from "../api/credit"
import { creditKeys } from "../api/keys"
import type { CreditProfileListRow } from "../types"

/**
 * Credit settings for one customer at one branch.
 *
 * A manager lowers a limit directly and raises any increase as a `CREDIT_LIMIT_CHANGE` request
 * with a reason (P12-D21). An admin changes either direction directly. The dialog never guesses
 * the actor's branch: the API takes it from the session.
 */
export function CreditProfileDialog({
	open,
	onOpenChange,
	customerId,
	branchId,
	branchName,
	profile,
	isAdmin,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	customerId: string
	branchId: string | null
	branchName: string | null
	profile: CreditProfileListRow | null
	isAdmin: boolean
}) {
	const queryClient = useQueryClient()

	const [limit, setLimit] = useState("")
	const [termDays, setTermDays] = useState("0")
	const [hold, setHold] = useState(false)
	const [notes, setNotes] = useState("")
	const [reason, setReason] = useState("")
	const [formError, setFormError] = useState<string | null>(null)

	useEffect(() => {
		if (!open) return
		setLimit(profile ? formatMinorPlain(profile.limitMinor) : "0")
		setTermDays(String(profile?.paymentTermDays ?? 0))
		setHold(profile?.hold ?? false)
		setNotes(profile?.notes ?? "")
		setReason("")
		setFormError(null)
	}, [open, profile])

	const currentLimitMinor = profile?.limitMinor ?? 0
	const parsedLimitMinor = parseGhsToMinor(limit)
	const requestMode =
		!isAdmin && parsedLimitMinor !== null && parsedLimitMinor > currentLimitMinor

	async function invalidate() {
		await queryClient.invalidateQueries({ queryKey: creditKeys.profileList(customerId) })
		// The customers profile key, spelled literally: importing the customers barrel here
		// would close the customers ↔ credit cycle (that module already imports this one).
		await queryClient.invalidateQueries({ queryKey: ["customer", customerId] })
		await queryClient.invalidateQueries({ queryKey: approvalKeys.all })
	}

	const saveMutation = useMutation({
		mutationFn: (input: {
			limitMinor: number
			paymentTermDays: number
			hold: boolean
			notes: string | null
		}) =>
			updateCreditProfile(customerId, {
				branchId: branchId ?? undefined,
				...input,
			}),
		onSuccess: async () => {
			toast.success("Credit settings saved")
			await invalidate()
			onOpenChange(false)
		},
		onError: (error) => {
			if (error instanceof ApiError && (error.status === 400 || error.status === 403)) {
				setFormError(error.message)
				return
			}
			toastApiError(error)
		},
	})

	const requestMutation = useMutation({
		mutationFn: (input: { proposedLimitMinor: number; reason: string }) =>
			requestCreditLimitIncrease(customerId, input),
		onSuccess: async (result) => {
			toast.success("Credit limit increase requested", {
				description: (
					<Link
						to="/approvals/$approvalId"
						params={{ approvalId: result.approvalId }}
						className="font-medium text-primary hover:underline"
					>
						Review the request
					</Link>
				),
			})
			await invalidate()
			onOpenChange(false)
		},
		onError: (error) => {
			if (error instanceof ApiError && (error.status === 400 || error.status === 403 || error.status === 409)) {
				setFormError(error.message)
				return
			}
			toastApiError(error)
		},
	})

	const pending = saveMutation.isPending || requestMutation.isPending

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		setFormError(null)

		const limitMinor = parseGhsToMinor(limit)
		if (limitMinor === null) {
			setFormError("Enter the credit limit in GHS, for example 500 or 500.50.")
			return
		}

		if (!isAdmin && limitMinor > currentLimitMinor) {
			const trimmed = reason.trim()
			if (trimmed.length < 3) {
				setFormError("Say why the limit should increase; the admin deciding it needs a reason.")
				return
			}
			requestMutation.mutate({ proposedLimitMinor: limitMinor, reason: trimmed })
			return
		}

		const days = Number(termDays)
		if (!Number.isInteger(days) || days < 0 || days > 365) {
			setFormError("Payment terms must be a whole number of days between 0 and 365.")
			return
		}

		saveMutation.mutate({
			limitMinor,
			paymentTermDays: days,
			hold,
			notes: notes.trim() || null,
		})
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Credit settings</DialogTitle>
					<DialogDescription>
						{branchName
							? `Applies to ${branchName} only. The balance always follows the ledger.`
							: "The balance always follows the ledger."}
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="grid gap-4">
					<div className="grid gap-1.5">
						<Label htmlFor="credit-limit">Credit limit (GHS)</Label>
						<Input
							id="credit-limit"
							required
							inputMode="decimal"
							value={limit}
							onChange={(event) => setLimit(event.target.value)}
						/>
						<p className="text-xs text-muted-foreground">
							{isAdmin
								? "Charges that would push the balance past this limit need a manager override."
								: `Current limit: ${formatGhs(currentLimitMinor)}. A decrease applies immediately; an increase is a request.`}
						</p>
					</div>

					{requestMode ? (
						<>
							<StatusNote tone="info">
								Only the limit increase is requested. Payment terms, hold and notes are saved
								directly, so change them in a separate save.
							</StatusNote>
							<div className="grid gap-1.5">
								<Label htmlFor="credit-limit-reason">
									Reason for the increase{" "}
									<span className="font-normal text-muted-foreground">(required)</span>
								</Label>
								<Textarea
									id="credit-limit-reason"
									required
									rows={3}
									maxLength={300}
									value={reason}
									onChange={(event) => setReason(event.target.value)}
									aria-describedby="credit-limit-reason-hint"
								/>
								<p id="credit-limit-reason-hint" className="text-xs text-muted-foreground">
									An admin decides the request. Explain the trading need or the customer's history.
								</p>
							</div>
						</>
					) : null}

					<div className="grid gap-1.5">
						<Label htmlFor="credit-term-days">Payment terms (days)</Label>
						<Input
							id="credit-term-days"
							type="number"
							min={0}
							max={365}
							step={1}
							required
							disabled={requestMode}
							value={termDays}
							onChange={(event) => setTermDays(event.target.value)}
						/>
						<p className="text-xs text-muted-foreground">
							0 means due on the day of sale (NET 0); 14 means due 14 days later (NET 14).
						</p>
					</div>

					<div className="flex items-center gap-2">
						<Switch
							id="credit-hold"
							checked={hold}
							onCheckedChange={setHold}
							disabled={requestMode}
						/>
						<Label htmlFor="credit-hold" className="text-sm">
							On hold — blocks new charges (collections still allowed)
						</Label>
					</div>

					<div className="grid gap-1.5">
						<Label htmlFor="credit-notes">
							Notes <span className="font-normal text-muted-foreground">(optional)</span>
						</Label>
						<Textarea
							id="credit-notes"
							rows={2}
							maxLength={300}
							disabled={requestMode}
							value={notes}
							onChange={(event) => setNotes(event.target.value)}
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
						<Button type="submit" disabled={pending}>
							{pending
								? "Saving…"
								: requestMode
									? "Request increase"
									: "Save settings"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
