import { PIN_MAX_LENGTH, PIN_MIN_LENGTH, PIN_PROBLEM_MESSAGES, pinProblem } from "@sceptre/shared"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { type FormEvent, useState } from "react"
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
import { ApiError } from "#/lib/api"
import { toastApiError } from "#/lib/toast"
import { setStaffPin, staffPinStatus } from "../api/staff"
import type { Staff } from "../types"

/**
 * Sets a temporary POS PIN. The server hashes it (Argon2id), bumps the PIN
 * version, and revokes every terminal binding, so the cashier has to authorize
 * again at the till and then choose their own PIN.
 */
export function PinDialog({ staff, onClose }: { staff: Staff; onClose: () => void }) {
	const queryClient = useQueryClient()
	const [pin, setPin] = useState("")
	const [confirm, setConfirm] = useState("")
	const [formError, setFormError] = useState<string | null>(null)

	const statusQuery = useQuery({
		queryKey: ["staff-pin", staff.id],
		queryFn: () => staffPinStatus(staff.id),
	})

	const setPinMutation = useMutation({
		mutationFn: () => setStaffPin(staff.id, { pin }),
		onSuccess: async (data) => {
			toast.success(`Temporary PIN set (version ${data.pinVersion})`, {
				description: `${staff.name} must change it at the POS on first use.`,
			})
			await queryClient.invalidateQueries({ queryKey: ["staff"] })
			await queryClient.invalidateQueries({ queryKey: ["staff-pin", staff.id] })
			onClose()
		},
		onError: (error) => {
			setFormError(error instanceof ApiError ? error.message : "Could not set the PIN")
			toastApiError(error)
		},
	})

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		const problem = pinProblem(pin)
		if (problem) {
			setFormError(PIN_PROBLEM_MESSAGES[problem])
			return
		}
		if (pin !== confirm) {
			setFormError("The PINs do not match")
			return
		}
		setFormError(null)
		setPinMutation.mutate()
	}

	const activeBindings = statusQuery.data?.activeBindings ?? 0

	return (
		<Dialog open onOpenChange={(next) => !next && onClose()}>
			<DialogContent className="sm:max-w-sm">
				<DialogHeader>
					<DialogTitle>Set a PIN for {staff.name}</DialogTitle>
					<DialogDescription>
						{staff.staffId ? `${staff.staffId} · ` : ""}
						{staff.email}
					</DialogDescription>
				</DialogHeader>

				<div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
					This becomes a <strong>temporary PIN</strong>. It signs the cashier out of every POS
					terminal
					{activeBindings > 0
						? ` (${activeBindings} active binding${activeBindings === 1 ? "" : "s"})`
						: ""}{" "}
					and they must choose a new PIN at the till on first use.
				</div>

				<form onSubmit={handleSubmit} className="grid gap-4">
					<div className="grid gap-1.5">
						<Label htmlFor="pin-new">PIN</Label>
						<Input
							id="pin-new"
							type="password"
							inputMode="numeric"
							autoComplete="new-password"
							minLength={PIN_MIN_LENGTH}
							maxLength={PIN_MAX_LENGTH}
							pattern="\d*"
							required
							value={pin}
							onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
						/>
						<p className="text-xs text-muted-foreground">
							{PIN_MIN_LENGTH}–{PIN_MAX_LENGTH} digits. Avoid repeated digits and straight
							sequences.
						</p>
					</div>

					<div className="grid gap-1.5">
						<Label htmlFor="pin-confirm">Confirm PIN</Label>
						<Input
							id="pin-confirm"
							type="password"
							inputMode="numeric"
							autoComplete="new-password"
							minLength={PIN_MIN_LENGTH}
							maxLength={PIN_MAX_LENGTH}
							pattern="\d*"
							required
							value={confirm}
							onChange={(event) => setConfirm(event.target.value.replace(/\D/g, ""))}
						/>
					</div>

					{formError ? (
						<p role="alert" className="text-sm text-destructive">
							{formError}
						</p>
					) : null}

					<DialogFooter>
						<Button type="button" variant="outline" onClick={onClose}>
							Cancel
						</Button>
						<Button type="submit" disabled={setPinMutation.isPending}>
							{setPinMutation.isPending ? "Setting…" : "Set PIN"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
