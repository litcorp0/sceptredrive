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
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"
import { Switch } from "#/components/ui/switch"
import { Textarea } from "#/components/ui/textarea"
import { ApiError } from "#/lib/api"
import { formatMinorPlain, parseGhsToMinor } from "#/lib/format"
import { toastApiError } from "#/lib/toast"
import { updateCreditProfile } from "../api/credit"
import { creditKeys } from "../api/keys"
import type { CreditProfileListRow } from "../types"

/**
 * Credit settings for one customer at one branch. Saving creates the profile
 * when none exists yet (the API insert-or-locks it) — the balance is never
 * settable from here; it always follows the ledger.
 */
export function CreditProfileDialog({
	open,
	onOpenChange,
	customerId,
	branchId,
	branchName,
	profile,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	customerId: string
	branchId: string | null
	branchName: string | null
	profile: CreditProfileListRow | null
}) {
	const queryClient = useQueryClient()

	const [limit, setLimit] = useState("")
	const [termDays, setTermDays] = useState("0")
	const [hold, setHold] = useState(false)
	const [notes, setNotes] = useState("")
	const [formError, setFormError] = useState<string | null>(null)

	useEffect(() => {
		if (!open) return
		setLimit(profile ? formatMinorPlain(profile.limitMinor) : "0")
		setTermDays(String(profile?.paymentTermDays ?? 0))
		setHold(profile?.hold ?? false)
		setNotes(profile?.notes ?? "")
		setFormError(null)
	}, [open, profile])

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
			await queryClient.invalidateQueries({ queryKey: creditKeys.profileList(customerId) })
			// The customers profile key, still owned by `lib/api-types`' caller; Plan 09 moves it
			// behind `#/modules/customers` and this invalidation imports it from there.
			await queryClient.invalidateQueries({ queryKey: ["customer", customerId] })
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

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		setFormError(null)

		const limitMinor = parseGhsToMinor(limit)
		if (limitMinor === null) {
			setFormError("Enter the credit limit in GHS, for example 500 or 500.50.")
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
							Charges that would push the balance past this limit need a manager override.
						</p>
					</div>

					<div className="grid gap-1.5">
						<Label htmlFor="credit-term-days">Payment terms (days)</Label>
						<Input
							id="credit-term-days"
							type="number"
							min={0}
							max={365}
							step={1}
							required
							value={termDays}
							onChange={(event) => setTermDays(event.target.value)}
						/>
						<p className="text-xs text-muted-foreground">
							0 means due on the day of sale (NET 0); 14 means due 14 days later (NET 14).
						</p>
					</div>

					<div className="flex items-center gap-2">
						<Switch id="credit-hold" checked={hold} onCheckedChange={setHold} />
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
						<Button type="submit" disabled={saveMutation.isPending}>
							{saveMutation.isPending ? "Saving…" : "Save settings"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
