import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { type FormEvent, useEffect, useRef, useState } from "react"
import { StatusBadge } from "#/components/common/status-badge"
import { type PickedSupplier, SupplierCombobox } from "#/components/common/supplier-combobox"
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
import { useBranch } from "#/lib/branch-context"
import { formatGhs, parseGhsToMinor } from "#/lib/format"
import { toastApiError } from "#/lib/toast"
import { supplierDetailOptions, supplierKeys } from "#/modules/suppliers"
import { payablesKeys } from "../api/keys"
import { createTransfer, providerBalanceOptions, verifyTransfer } from "../api/payables"
import type { TransferCreateInput, TransferDetail } from "../types"
import {
	type AllocationDraft,
	AllocationEditor,
	allocationDraftInputs,
	allocationDraftsTotal,
} from "./allocation-editor"
import { TransferOtpForm } from "./transfer-otp-form"
import { TransferStatusBadge } from "./transfer-status-badge"

/** The two figures a refused transfer must show, read from the error's own details. */
interface BalanceRefusal {
	balanceMinor: number | null
	amountMinor: number | null
	message: string
}

function balanceRefusal(error: ApiError): BalanceRefusal | null {
	if (error.code !== "INSUFFICIENT_PROVIDER_BALANCE") return null
	const balanceMinor =
		typeof error.details?.balanceMinor === "number" ? error.details.balanceMinor : null
	const amountMinor =
		typeof error.details?.amountMinor === "number" ? error.details.amountMinor : null
	return { balanceMinor, amountMinor, message: error.message }
}

/**
 * Start a supplier transfer, then stay open and tell the truth about what happened.
 *
 * The dialog is two screens in one: a form that records an instruction, and a status panel that
 * reports the provider's answer. It never closes itself on success, because "sent" and "paid" are
 * different facts and the operator needs to see which one they have. The supplier is marked paid
 * only when the panel shows a posted payment (P14-D22).
 */
export function TransferDialog({
	open,
	onOpenChange,
	initialSupplier = null,
	fixedSupplierId = null,
	initialPaymentDetailId = "",
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	initialSupplier?: PickedSupplier | null
	/** Opened from a supplier's payment-detail row: the supplier cannot be changed. */
	fixedSupplierId?: string | null
	initialPaymentDetailId?: string
}) {
	const queryClient = useQueryClient()
	const { branches, activeBranchId, activeBranch, canSelectBranch } = useBranch()

	const [supplier, setSupplier] = useState<PickedSupplier | null>(null)
	const [branchId, setBranchId] = useState("")
	const [amount, setAmount] = useState("")
	const [paymentDetailId, setPaymentDetailId] = useState("")
	const [note, setNote] = useState("")
	const [allocations, setAllocations] = useState<AllocationDraft>({})
	const [formError, setFormError] = useState<string | null>(null)
	const [balanceRefused, setBalanceRefused] = useState<BalanceRefusal | null>(null)
	const [result, setResult] = useState<TransferDetail | null>(null)
	const [providerUnavailable, setProviderUnavailable] = useState(false)
	const [session, setSession] = useState(0)

	// One key per form session: a network failure retries the same instruction and the
	// server replays it. A fresh attempt is a new key, by construction.
	const idempotencyKey = useRef<string | null>(null)
	const wasOpen = useRef(false)

	const effectiveSupplierId = fixedSupplierId ?? supplier?.id ?? null

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

		setSupplier(initialSupplier)
		setBranchId(activeBranchId ?? "")
		setAmount("")
		setPaymentDetailId(initialPaymentDetailId)
		setNote("")
		setAllocations({})
		setFormError(null)
		setBalanceRefused(null)
		setResult(null)
		setProviderUnavailable(false)
		setSession((value) => value + 1)
		idempotencyKey.current = null
	}, [open, initialSupplier, initialPaymentDetailId, activeBranchId])

	useEffect(() => {
		if (!canSelectBranch) return
		if (branchId !== "") return
		setBranchId(activeBranchId ?? branches[0]?.id ?? "")
	}, [canSelectBranch, branchId, activeBranchId, branches])

	const supplierQuery = useQuery({
		...supplierDetailOptions(effectiveSupplierId as string),
		enabled: open && effectiveSupplierId !== null,
	})

	const balanceQuery = useQuery({
		...providerBalanceOptions(),
		enabled: open && result === null,
	})

	const paymentDetails = (supplierQuery.data?.paymentDetails ?? []).filter(
		(detail) => detail.isActive,
	)
	const selectedDetail = paymentDetails.find((detail) => detail.id === paymentDetailId) ?? null

	const amountMinor = parseGhsToMinor(amount) ?? 0
	const allocatedMinor = allocationDraftsTotal(allocations)
	const balanceMinor = balanceQuery.data?.balanceMinor ?? null
	const balanceUnavailable =
		balanceQuery.isError ||
		(balanceQuery.data !== undefined && balanceQuery.data.balanceMinor === null)

	const transferMutation = useMutation({
		mutationFn: (input: TransferCreateInput) => createTransfer(input),
		onSuccess: async (data) => {
			idempotencyKey.current = null
			setFormError(null)
			setBalanceRefused(null)
			setResult(data.transfer)
			setProviderUnavailable(data.providerUnavailable)
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: payablesKeys.transfers }),
				queryClient.invalidateQueries({ queryKey: payablesKeys.reconciliation }),
				queryClient.invalidateQueries({ queryKey: payablesKeys.providerBalance }),
				queryClient.invalidateQueries({
					queryKey: payablesKeys.transferDetail(data.transfer.transfer.id),
				}),
				queryClient.invalidateQueries({
					queryKey: supplierKeys.byId(data.transfer.transfer.supplierId),
				}),
			])
		},
		onError: (error) => {
			if (error instanceof ApiError) {
				const refusal = balanceRefusal(error)
				if (refusal) {
					setBalanceRefused(refusal)
					return
				}
				if (error.status === 400 || error.status === 409) {
					idempotencyKey.current = null
					setFormError(error.message)
					return
				}
			}
			toastApiError(error)
		},
	})

	const verifyMutation = useMutation({
		mutationFn: (transferId: string) => verifyTransfer(transferId),
		onSuccess: async (data) => {
			setResult(data.transfer)
			setProviderUnavailable(false)
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: payablesKeys.transfers }),
				queryClient.invalidateQueries({ queryKey: payablesKeys.reconciliation }),
				queryClient.invalidateQueries({ queryKey: payablesKeys.providerBalance }),
			])
		},
		onError: (error) => toastApiError(error),
	})

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		setFormError(null)
		setBalanceRefused(null)

		if (amountMinor <= 0) {
			setFormError("Enter a transfer amount like 250.00.")
			return
		}
		if (!effectiveSupplierId) {
			setFormError("Choose the supplier this transfer pays.")
			return
		}
		if (canSelectBranch && !branchId) {
			setFormError("Choose the branch that owns this transfer.")
			return
		}
		if (!paymentDetailId) {
			setFormError("Choose the bank or mobile-money destination.")
			return
		}
		if (selectedDetail === null) {
			idempotencyKey.current = null
			setFormError("The chosen payment detail is not active for this supplier.")
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
			setFormError("Allocations cannot exceed the transfer amount.")
			return
		}
		if (balanceMinor !== null && amountMinor > balanceMinor) {
			setFormError(
				`This transfer needs ${formatGhs(amountMinor)} but the Paystack balance is ${formatGhs(balanceMinor)}. Lower the amount or top up the balance.`,
			)
			return
		}

		const allocationInputs = allocationDraftInputs(allocations)

		transferMutation.mutate({
			supplierId: effectiveSupplierId,
			branchId: canSelectBranch ? branchId : undefined,
			paymentDetailId,
			amountMinor,
			note: note.trim() || undefined,
			allocations: allocationInputs.length > 0 ? allocationInputs : undefined,
			idempotencyKey: takeIdempotencyKey(),
		})
	}

	function tryAgain() {
		idempotencyKey.current = null
		setResult(null)
		setProviderUnavailable(false)
		setFormError(null)
		setBalanceRefused(null)
		setPaymentDetailId("")
		setAmount("")
		setNote("")
		setAllocations({})
		setSession((value) => value + 1)
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>Send a supplier transfer</DialogTitle>
					<DialogDescription>
						Paystack moves the money from the business balance. The supplier is marked paid only
						when the provider confirms the transfer and the payment is posted.
					</DialogDescription>
				</DialogHeader>

				{result ? (
					<div className="grid gap-4" key={session}>
						<div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
							<div className="flex flex-wrap items-center justify-between gap-2">
								<span className="font-mono text-xs font-medium">{result.transfer.reference}</span>
								<TransferStatusBadge status={result.transfer.status} />
							</div>
							<p className="mt-1 text-muted-foreground">
								{formatGhs(result.transfer.amountMinor)} to {result.transfer.supplierName}
							</p>
						</div>

						<TransferStatusPanel
							detail={result}
							providerUnavailable={providerUnavailable}
							verifying={verifyMutation.isPending}
							onCheck={() => verifyMutation.mutate(result.transfer.id)}
							onFinalized={(next) => {
								setResult(next)
								setProviderUnavailable(false)
							}}
							onTryAgain={tryAgain}
						/>

						<DialogFooter>
							<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
								Close
							</Button>
						</DialogFooter>
					</div>
				) : (
					<form onSubmit={handleSubmit} className="grid gap-4" key={session}>
						<div className="grid gap-4 sm:grid-cols-2">
							<div className="grid gap-1.5">
								<Label>Supplier</Label>
								{fixedSupplierId ? (
									<p className="rounded-md border bg-muted/40 px-3 py-2 text-sm font-medium">
										{supplierQuery.data?.supplier.name ?? "This supplier"}
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
									<Label htmlFor="transfer-branch">Branch</Label>
									<Select
										value={branchId}
										onValueChange={(value) => {
											setBranchId(value)
											setAllocations({})
										}}
									>
										<SelectTrigger id="transfer-branch" className="w-full">
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
								<Label htmlFor="transfer-amount">Amount</Label>
								<Input
									id="transfer-amount"
									inputMode="decimal"
									placeholder="0.00"
									value={amount}
									onChange={(event) => {
										setAmount(event.target.value)
										setBalanceRefused(null)
									}}
								/>
								<p className="text-xs text-muted-foreground">
									GHS — it must fit the Paystack balance below.
								</p>
							</div>
							<div className="grid gap-1.5">
								<Label>Paystack balance</Label>
								<p
									data-slot="provider-balance"
									className={
										balanceUnavailable
											? "rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
											: "rounded-md border bg-muted/40 px-3 py-2 text-sm tabular-nums"
									}
								>
									{balanceQuery.isLoading
										? "Checking the provider balance…"
										: balanceUnavailable
											? "Unavailable — the server checks again before it sends."
											: balanceMinor === null
												? "Unavailable — the server checks again before it sends."
												: `${formatGhs(balanceMinor)} available`}
								</p>
							</div>
						</div>

						<div className="grid gap-1.5">
							<Label htmlFor="transfer-detail">Pay to</Label>
							<Select
								value={paymentDetailId}
								onValueChange={(value) => {
									setPaymentDetailId(value)
								}}
							>
								<SelectTrigger id="transfer-detail" className="w-full">
									<SelectValue placeholder="Choose a bank or mobile-money detail" />
								</SelectTrigger>
								<SelectContent>
									{paymentDetails.map((detail) => (
										<SelectItem key={detail.id} value={detail.id}>
											<span className="flex items-center gap-2">
												<span>
													{detail.label ?? detail.bankName ?? "Payment detail"} ·{" "}
													{detail.accountNumberMasked ?? detail.phone ?? ""}
												</span>
												<StatusBadge variant={detail.recipientReady ? "ok" : "muted"}>
													{detail.recipientReady ? "Paystack ready" : "Creates recipient"}
												</StatusBadge>
											</span>
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							{paymentDetails.length === 0 ? (
								<p className="text-xs text-muted-foreground">
									This supplier has no active bank or mobile-money detail. Add one on the supplier
									page before transferring.
								</p>
							) : selectedDetail ? (
								<p className="text-xs text-muted-foreground">
									{selectedDetail.recipientReady
										? "Paystack already has a recipient for this destination."
										: "The first transfer creates the Paystack recipient."}
								</p>
							) : null}
						</div>

						<div className="grid gap-1.5">
							<Label>Allocations</Label>
							<AllocationEditor
								supplierId={effectiveSupplierId}
								branchId={canSelectBranch ? branchId || null : (activeBranchId ?? null)}
								paymentAmountMinor={amountMinor}
								allocations={allocations}
								onChange={setAllocations}
							/>
						</div>

						<div className="grid gap-1.5">
							<Label htmlFor="transfer-note">
								Note <span className="font-normal text-muted-foreground">(optional)</span>
							</Label>
							<Textarea
								id="transfer-note"
								rows={2}
								maxLength={500}
								value={note}
								onChange={(event) => setNote(event.target.value)}
							/>
						</div>

						{balanceRefused ? (
							<div
								role="alert"
								data-slot="provider-balance-refusal"
								className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
							>
								<p className="font-medium">The Paystack balance cannot cover this transfer.</p>
								<p className="mt-1">
									{balanceRefused.balanceMinor !== null && balanceRefused.amountMinor !== null
										? `Balance ${formatGhs(balanceRefused.balanceMinor)} · transfer ${formatGhs(balanceRefused.amountMinor)}.`
										: balanceRefused.message}
								</p>
							</div>
						) : null}

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
							<Button type="submit" disabled={transferMutation.isPending}>
								{transferMutation.isPending ? "Sending…" : "Send transfer"}
							</Button>
						</DialogFooter>
					</form>
				)}
			</DialogContent>
		</Dialog>
	)
}

/**
 * The status panel is the whole story: what the instruction is, whether money moved, and the one
 * action a person can take next. Nothing here advances a state by itself.
 */
function TransferStatusPanel({
	detail,
	providerUnavailable,
	verifying,
	onCheck,
	onFinalized,
	onTryAgain,
}: {
	detail: TransferDetail
	providerUnavailable: boolean
	verifying: boolean
	onCheck: () => void
	onFinalized: (detail: TransferDetail) => void
	onTryAgain: () => void
}) {
	const { transfer, payment } = detail
	const failure =
		transfer.status === "FAILED" || transfer.status === "BLOCKED" || transfer.status === "REJECTED"

	return (
		<div className="grid gap-3 rounded-md border p-3">
			{transfer.status === "PENDING" ? (
				<div className="grid gap-2">
					<p className="text-sm">
						Sent to Paystack. Nothing has left the balance yet, and the supplier is not paid.
					</p>
					{providerUnavailable ? (
						<p className="text-xs text-muted-foreground">
							Paystack did not answer. This stays pending and is checked automatically; you can
							check now.
						</p>
					) : null}
					<Button type="button" size="sm" variant="outline" disabled={verifying} onClick={onCheck}>
						{verifying ? "Checking…" : "Check status"}
					</Button>
				</div>
			) : null}

			{transfer.status === "AWAITING_OTP" ? (
				<div className="grid gap-3">
					<p className="text-sm">
						Paystack is holding this transfer until an OTP is confirmed. Nothing has left the
						balance yet, and the supplier is not paid.
					</p>
					<TransferOtpForm transferId={transfer.id} onFinalized={onFinalized} />
				</div>
			) : null}

			{transfer.status === "SUCCESS" ? (
				<div className="grid gap-2">
					<p className="text-sm">The money moved and a supplier payment was posted.</p>
					{payment ? (
						<Link
							to="/suppliers/payments/$paymentId"
							params={{ paymentId: payment.payment.id }}
							className="text-sm font-medium text-brand-ink hover:underline"
						>
							Open payment {payment.payment.number}
						</Link>
					) : (
						<p role="alert" className="text-sm text-destructive">
							Paystack reported success but no payment was posted. Do not record one by hand;
							investigate the transfer first.
						</p>
					)}
				</div>
			) : null}

			{failure ? (
				<div className="grid gap-2">
					<p className="text-sm">
						The transfer did not send. The supplier is not paid and no payment exists.
					</p>
					<p className="text-sm text-destructive">
						{transfer.failureCode ? (
							<span className="font-mono text-xs">{transfer.failureCode}</span>
						) : null}
						{transfer.failureCode && transfer.failureMessage ? " · " : null}
						{transfer.failureMessage ?? "The provider refused the transfer."}
					</p>
					<Button type="button" size="sm" onClick={onTryAgain}>
						Try again
					</Button>
				</div>
			) : null}

			{transfer.status === "REVERSED" ? (
				<div className="grid gap-2">
					<p className="text-sm text-destructive">
						Paystack reversed this transfer and the money returned.
					</p>
					{payment ? (
						<>
							<p className="text-sm">
								The payment stands until somebody voids it. Opening the payment is where that
								happens.
							</p>
							<Link
								to="/suppliers/payments/$paymentId"
								params={{ paymentId: payment.payment.id }}
								className="text-sm font-medium text-brand-ink hover:underline"
							>
								Open payment {payment.payment.number} to void it
							</Link>
						</>
					) : (
						<p className="text-sm">No payment was posted, so nothing else needs undoing.</p>
					)}
				</div>
			) : null}

			{transfer.paymentId ? (
				<p className="text-xs text-muted-foreground">
					Posted payment {payment?.payment.number ?? transfer.paymentId}.
				</p>
			) : null}
		</div>
	)
}
