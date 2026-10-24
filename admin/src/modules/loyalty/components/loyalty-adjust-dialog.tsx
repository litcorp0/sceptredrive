import { formatCount } from "@sceptre/shared"
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
import { customerKeys } from "#/modules/customers"
import { loyaltyKeys } from "../api/keys"
import { createLoyaltyEntry } from "../api/loyalty"
import type { LoyaltyReasonCode, LoyaltyStaffKind } from "../types"
import {
	impliedValueMinor,
	LOYALTY_ADJUST_REASONS,
	LOYALTY_REASON_LABELS,
	signedPoints,
} from "../utils/loyalty"

export interface LoyaltyRates {
	earnPointsPerCedi: number
	pointsPerCedi: number
	minimumRedeemPoints: number
}

const KIND_HINTS: Record<LoyaltyStaffKind, string> = {
	ADJUST: "Corrects the balance in either direction, with a reason.",
	EARN: "Credits points for an amount paid outside the POS (floors per sale).",
	REDEEM: "Uses the customer's points, consuming the oldest lots first.",
	CLAWBACK: "Takes points back from the customer (returns and reversals).",
}

export function LoyaltyAdjustDialog({
	open,
	onOpenChange,
	customerId,
	branchId,
	branchName,
	balancePoints,
	rates,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	customerId: string
	branchId: string | null
	branchName: string | null
	balancePoints: number
	rates: LoyaltyRates | null
}) {
	const queryClient = useQueryClient()

	const [kind, setKind] = useState<LoyaltyStaffKind>("ADJUST")
	const [direction, setDirection] = useState<"add" | "remove">("add")
	const [points, setPoints] = useState("")
	const [amount, setAmount] = useState("")
	const [reasonCode, setReasonCode] = useState("")
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
		setKind("ADJUST")
		setDirection("add")
		setPoints("")
		setAmount("")
		setReasonCode("")
		setNote("")
		setFormError(null)
		idempotencyKey.current = null
	}, [open])

	const postMutation = useMutation({
		mutationFn: (input: {
			points?: number
			netPaidMinor?: number
			reasonCode?: LoyaltyReasonCode
			note?: string
		}) =>
			createLoyaltyEntry({
				customerId,
				branchId: branchId ?? undefined,
				kind,
				...input,
				idempotencyKey: takeIdempotencyKey(),
			}),
		onSuccess: async (data) => {
			if (data.entry === null) {
				toast.info("No points recorded — the amount floors to below one point at the current rate.")
			} else if (data.quote) {
				toast.success(
					`Redemption recorded — ${signedPoints(data.entry.pointsDelta)} points (${formatGhs(data.quote.discountMinor)} value)`,
				)
			} else {
				const label: Record<LoyaltyStaffKind, string> = {
					EARN: "Earn",
					ADJUST: "Adjustment",
					CLAWBACK: "Clawback",
					REDEEM: "Redemption",
				}
				toast.success(`${label[kind]} recorded — ${signedPoints(data.entry.pointsDelta)} points`)
			}
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: loyaltyKeys.account(customerId) }),
				queryClient.invalidateQueries({ queryKey: customerKeys.byId(customerId) }),
				queryClient.invalidateQueries({ queryKey: loyaltyKeys.liability }),
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

	function changeKind(value: LoyaltyStaffKind) {
		setKind(value)
		setPoints("")
		setAmount("")
		setDirection("add")
		setReasonCode("")
		setFormError(null)
	}

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		setFormError(null)

		if (kind === "EARN") {
			const parsed = parseGhsToMinor(amount)
			if (parsed === null || parsed < 1) {
				setFormError("Enter the amount paid in GHS, for example 100 or 100.50.")
				return
			}
			postMutation.mutate({ netPaidMinor: parsed, note: note.trim() || undefined })
			return
		}

		const trimmed = points.trim()
		if (!/^\d+$/.test(trimmed) || Number(trimmed) < 1) {
			setFormError("Enter a positive whole number of points.")
			return
		}
		const parsedPoints = Number(trimmed)

		if (kind === "ADJUST" && reasonCode === "") {
			setFormError("Choose a reason for the adjustment.")
			return
		}

		const signed =
			kind === "ADJUST" ? (direction === "remove" ? -parsedPoints : parsedPoints) : parsedPoints
		postMutation.mutate({
			points: signed,
			reasonCode: kind === "ADJUST" ? (reasonCode as LoyaltyReasonCode) : undefined,
			note: note.trim() || undefined,
		})
	}

	const parsedPoints = /^\d+$/.test(points.trim()) ? Number(points.trim()) : null
	const parsedAmount = kind === "EARN" ? parseGhsToMinor(amount) : null
	const belowRedeemMinimum =
		kind === "REDEEM" &&
		parsedPoints !== null &&
		rates !== null &&
		parsedPoints < rates.minimumRedeemPoints
	const shortfall =
		(kind === "CLAWBACK" || (kind === "ADJUST" && direction === "remove")) &&
		parsedPoints !== null &&
		parsedPoints > balancePoints
	const signedPreview =
		parsedPoints === null
			? null
			: kind === "ADJUST" && direction === "remove"
				? -parsedPoints
				: kind === "CLAWBACK" || kind === "REDEEM"
					? -parsedPoints
					: parsedPoints

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Adjust loyalty points</DialogTitle>
					<DialogDescription>
						Loyalty is one balance across branches; this posting is tagged to{" "}
						{branchName ?? "the ledger"}.
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="grid gap-4">
					<div className="grid gap-1.5">
						<Label htmlFor="loyalty-kind">Kind</Label>
						<Select value={kind} onValueChange={(value) => changeKind(value as LoyaltyStaffKind)}>
							<SelectTrigger id="loyalty-kind" className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="ADJUST">Adjust</SelectItem>
								<SelectItem value="EARN">Earn</SelectItem>
								<SelectItem value="REDEEM">Redeem</SelectItem>
								<SelectItem value="CLAWBACK">Clawback</SelectItem>
							</SelectContent>
						</Select>
						<p className="text-xs text-muted-foreground">{KIND_HINTS[kind]}</p>
					</div>

					{kind === "EARN" ? (
						<div className="grid gap-1.5">
							<Label htmlFor="loyalty-amount">Amount paid (GHS)</Label>
							<Input
								id="loyalty-amount"
								required
								inputMode="decimal"
								value={amount}
								onChange={(event) => setAmount(event.target.value)}
							/>
							{parsedAmount !== null && rates !== null ? (
								<p className="text-xs text-muted-foreground">
									= {formatCount(Math.floor((parsedAmount * rates.earnPointsPerCedi) / 100))} points
									at the current rate.
								</p>
							) : null}
						</div>
					) : (
						<div className="grid gap-1.5">
							<Label htmlFor="loyalty-points">Points</Label>
							<Input
								id="loyalty-points"
								required
								inputMode="numeric"
								value={points}
								onChange={(event) => setPoints(event.target.value)}
							/>
							{kind === "REDEEM" && parsedPoints !== null && rates !== null ? (
								<div className="grid gap-1">
									<p className="text-xs text-muted-foreground">
										≈ {formatGhs(impliedValueMinor(parsedPoints, rates.pointsPerCedi))} of
										redemption value at the current rate.
									</p>
									{belowRedeemMinimum ? (
										<p className="text-xs text-amber-700">
											Below the {formatCount(rates.minimumRedeemPoints)} point minimum — the server
											will reject this.
										</p>
									) : null}
								</div>
							) : null}
							{shortfall && signedPreview !== null ? (
								<p className="text-xs text-amber-700">
									This leaves the balance at {signedPoints(balancePoints + signedPreview)} points.
								</p>
							) : null}
						</div>
					)}

					{kind === "ADJUST" ? (
						<div className="grid gap-1.5">
							<Label htmlFor="loyalty-direction">Direction</Label>
							<Select
								value={direction}
								onValueChange={(value) => setDirection(value as "add" | "remove")}
							>
								<SelectTrigger id="loyalty-direction" className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="add">Add points</SelectItem>
									<SelectItem value="remove">Remove points</SelectItem>
								</SelectContent>
							</Select>
						</div>
					) : null}

					{kind === "CLAWBACK" ? (
						<p className="text-sm text-muted-foreground">
							Reason: <span className="font-medium text-foreground">Return</span>
						</p>
					) : null}

					{kind === "ADJUST" ? (
						<div className="grid gap-1.5">
							<Label htmlFor="loyalty-reason">Reason</Label>
							<Select value={reasonCode} onValueChange={setReasonCode}>
								<SelectTrigger id="loyalty-reason" className="w-full">
									<SelectValue placeholder="Choose a reason" />
								</SelectTrigger>
								<SelectContent>
									{LOYALTY_ADJUST_REASONS.map((value) => (
										<SelectItem key={value} value={value}>
											{LOYALTY_REASON_LABELS[value]}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					) : null}

					<div className="grid gap-1.5">
						<Label htmlFor="loyalty-note">
							Note <span className="font-normal text-muted-foreground">(optional)</span>
						</Label>
						<Textarea
							id="loyalty-note"
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
						<Button type="submit" disabled={postMutation.isPending || branchId === null}>
							{postMutation.isPending ? "Posting…" : "Post entry"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
