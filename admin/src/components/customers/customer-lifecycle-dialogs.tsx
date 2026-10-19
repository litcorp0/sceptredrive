import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { CheckIcon, XIcon } from "lucide-react"
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
import type { CreditProfileListRow, CustomerListRow } from "#/lib/api-types"
import { formatGhs } from "#/lib/format"
import { toastApiError } from "#/lib/toast"

/** Case-management actions: archive (blocks new credit), reactivate, anonymize. */

export function ArchiveCustomerDialog({
	open,
	onOpenChange,
	customer,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	customer: CustomerListRow
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
		mutationFn: () => api.customers.archive(customer.id, note.trim() || undefined),
		onSuccess: async (data) => {
			toast.success(`Customer ${data.customer.name} archived`)
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ["customers"] }),
				queryClient.invalidateQueries({ queryKey: ["customer", customer.id] }),
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
					<DialogTitle>Archive {customer.name}?</DialogTitle>
					<DialogDescription>
						Archiving blocks new credit at every branch. Collections, repayments, and the ledger
						keep working, and you can reactivate at any time.
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="grid gap-4">
					<div className="grid gap-1.5">
						<Label htmlFor="archive-note">
							Reason <span className="font-normal text-muted-foreground">(optional)</span>
						</Label>
						<Textarea
							id="archive-note"
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

					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							Cancel
						</Button>
						<Button type="submit" disabled={archiveMutation.isPending}>
							{archiveMutation.isPending ? "Archiving…" : "Archive customer"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}

export function ReactivateCustomerButton({ customer }: { customer: CustomerListRow }) {
	const queryClient = useQueryClient()

	const reactivateMutation = useMutation({
		mutationFn: () => api.customers.reactivate(customer.id),
		onSuccess: async (data) => {
			toast.success(`Customer ${data.customer.name} reactivated`)
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ["customers"] }),
				queryClient.invalidateQueries({ queryKey: ["customer", customer.id] }),
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

/**
 * Ghana DPA erasure. The dialog states the rule (every branch credit balance
 * and the loyalty balance must be zero), shows what still blocks it, and the
 * server enforces the same rule — its 409 is surfaced verbatim.
 */
export function AnonymizeCustomerDialog({
	open,
	onOpenChange,
	customer,
	profiles,
	loyaltyPoints,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	customer: CustomerListRow
	profiles: CreditProfileListRow[]
	loyaltyPoints: number | null
}) {
	const queryClient = useQueryClient()
	const navigate = useNavigate()
	const [note, setNote] = useState("")
	const [formError, setFormError] = useState<string | null>(null)

	const creditBlockers = profiles.filter((profile) => profile.balanceMinor !== 0)
	const loyaltyBlocked = (loyaltyPoints ?? 0) !== 0
	const ready = creditBlockers.length === 0 && !loyaltyBlocked && !customer.anonymizedAt

	useEffect(() => {
		if (!open) return
		setNote("")
		setFormError(null)
	}, [open])

	const anonymizeMutation = useMutation({
		mutationFn: () => api.customers.anonymize(customer.id, note.trim() || undefined),
		onSuccess: async () => {
			toast.success("Customer anonymized")
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ["customers"] }),
				queryClient.invalidateQueries({ queryKey: ["customer", customer.id] }),
			])
			onOpenChange(false)
			await navigate({ to: "/customers" })
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
		anonymizeMutation.mutate()
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Anonymize {customer.name}?</DialogTitle>
					<DialogDescription>
						Erases the name, phone, email, and address (Ghana DPA erasure). The credit and loyalty
						ledgers stay intact for audit. This cannot be undone.
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="grid gap-4">
					<ul className="grid gap-2 rounded-lg border p-3 text-sm">
						<li className="flex items-start gap-2">
							{creditBlockers.length === 0 ? (
								<>
									<CheckIcon
										className="mt-0.5 size-4 shrink-0 text-emerald-600"
										aria-hidden="true"
									/>
									<span>Every branch credit balance is zero.</span>
								</>
							) : (
								<>
									<XIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
									<span>
										Unreconciled credit:{" "}
										{creditBlockers
											.map((profile) => `${profile.branchCode} ${formatGhs(profile.balanceMinor)}`)
											.join(", ")}
									</span>
								</>
							)}
						</li>
						<li className="flex items-start gap-2">
							{loyaltyBlocked ? (
								<>
									<XIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
									<span>{loyaltyPoints} unreconciled loyalty points remain.</span>
								</>
							) : (
								<>
									<CheckIcon
										className="mt-0.5 size-4 shrink-0 text-emerald-600"
										aria-hidden="true"
									/>
									<span>Loyalty points balance is zero.</span>
								</>
							)}
						</li>
					</ul>

					<div className="grid gap-1.5">
						<Label htmlFor="anonymize-note">
							Note <span className="font-normal text-muted-foreground">(optional)</span>
						</Label>
						<Textarea
							id="anonymize-note"
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

					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							Cancel
						</Button>
						<Button
							type="submit"
							variant="destructive"
							disabled={anonymizeMutation.isPending || !ready}
						>
							{anonymizeMutation.isPending ? "Anonymizing…" : "Anonymize customer"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
