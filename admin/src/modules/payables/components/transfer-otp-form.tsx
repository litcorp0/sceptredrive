import { useMutation, useQueryClient } from "@tanstack/react-query"
import { type FormEvent, useState } from "react"
import { Button } from "#/components/ui/button"
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"
import { ApiError } from "#/lib/api"
import { toastApiError } from "#/lib/toast"
import { payablesKeys } from "../api/keys"
import { finalizeTransfer } from "../api/payables"
import type { TransferDetail } from "../types"

const OTP_PATTERN = /^\d{4,8}$/

/**
 * The second factor Paystack asks for when "Confirm transfers before sending" is on.
 *
 * Nothing moves until this succeeds, so the control is deliberately small: one code, one
 * button, and the provider's own words if it refuses the code. The form never changes the
 * transfer's status itself; it reports the API's answer to its caller.
 */
export function TransferOtpForm({
	transferId,
	onFinalized,
}: {
	transferId: string
	onFinalized: (detail: TransferDetail) => void
}) {
	const queryClient = useQueryClient()
	const [otp, setOtp] = useState("")
	const [formError, setFormError] = useState<string | null>(null)

	const finalizeMutation = useMutation({
		mutationFn: (code: string) => finalizeTransfer(transferId, { otp: code }),
		onSuccess: async (data) => {
			setOtp("")
			setFormError(null)
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: payablesKeys.transferDetail(transferId) }),
				queryClient.invalidateQueries({ queryKey: payablesKeys.transfers }),
				queryClient.invalidateQueries({ queryKey: payablesKeys.payments }),
				queryClient.invalidateQueries({ queryKey: payablesKeys.invoices }),
				queryClient.invalidateQueries({ queryKey: payablesKeys.outstanding }),
				queryClient.invalidateQueries({ queryKey: payablesKeys.reconciliation }),
				queryClient.invalidateQueries({ queryKey: payablesKeys.balances }),
			])
			onFinalized(data.transfer)
		},
		onError: (error) => {
			if (error instanceof ApiError && (error.status === 400 || error.status === 409)) {
				setFormError(error.message)
				return
			}
			toastApiError(error)
		},
	})

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		setFormError(null)
		if (!OTP_PATTERN.test(otp.trim())) {
			setFormError("Enter the 4–8 digit code Paystack sent.")
			return
		}
		finalizeMutation.mutate(otp.trim())
	}

	return (
		<form onSubmit={handleSubmit} className="grid gap-2">
			<div className="grid gap-1.5">
				<Label htmlFor={`transfer-otp-${transferId}`}>One-time password</Label>
				<Input
					id={`transfer-otp-${transferId}`}
					inputMode="numeric"
					autoComplete="one-time-code"
					maxLength={8}
					placeholder="4–8 digits"
					value={otp}
					onChange={(event) => setOtp(event.target.value)}
					aria-describedby={`transfer-otp-help-${transferId}`}
				/>
				<p id={`transfer-otp-help-${transferId}`} className="text-xs text-muted-foreground">
					The code Paystack sent to the bank or the business owner's phone. Nothing has moved until
					this is confirmed.
				</p>
			</div>
			{formError ? (
				<p role="alert" className="text-sm text-destructive">
					{formError}
				</p>
			) : null}
			<Button type="submit" size="sm" disabled={finalizeMutation.isPending}>
				{finalizeMutation.isPending ? "Finalising…" : "Finalise"}
			</Button>
		</form>
	)
}
