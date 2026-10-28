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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select"
import { ApiError } from "#/lib/api"
import { toastApiError } from "#/lib/toast"
import { supplierKeys } from "../api/keys"
import { addSupplierPaymentDetail, updateSupplierPaymentDetail } from "../api/suppliers"
import type { PaymentDetailInput, SupplierMomoNetwork, SupplierPaymentDetailView } from "../types"

export function PaymentDetailDialog({
	open,
	onOpenChange,
	supplierId,
	detail = null,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	supplierId: string
	/** When set, edits this payment detail instead of adding one. */
	detail?: SupplierPaymentDetailView | null
}) {
	const queryClient = useQueryClient()
	const isEdit = detail !== null

	const [method, setMethod] = useState<"BANK" | "MOMO">("BANK")
	const [label, setLabel] = useState("")
	const [accountName, setAccountName] = useState("")
	const [accountNumber, setAccountNumber] = useState("")
	const [bankName, setBankName] = useState("")
	const [bankCode, setBankCode] = useState("")
	const [momoNetwork, setMomoNetwork] = useState<SupplierMomoNetwork>("MTN")
	const [phone, setPhone] = useState("")
	const [formError, setFormError] = useState<string | null>(null)

	useEffect(() => {
		if (!open) return
		setMethod(detail?.method ?? "BANK")
		setLabel(detail?.label ?? "")
		setAccountName(detail?.accountName ?? "")
		setAccountNumber(detail?.accountNumber ?? "")
		setBankName(detail?.bankName ?? "")
		setBankCode(detail?.bankCode ?? "")
		setMomoNetwork(detail?.momoNetwork ?? "MTN")
		setPhone(detail?.phone ?? "")
		setFormError(null)
	}, [open, detail])

	const saveMutation = useMutation({
		mutationFn: () => {
			if (isEdit && detail) {
				// The API rejects cross-method fields, so send only the stored method's.
				return updateSupplierPaymentDetail(supplierId, detail.id, {
					label: label.trim() || null,
					accountName: accountName.trim() || undefined,
					...(detail.method === "BANK"
						? {
								accountNumber: accountNumber.trim(),
								bankName: bankName.trim(),
								bankCode: bankCode.trim() || null,
							}
						: {
								momoNetwork,
								phone: phone.trim(),
							}),
				})
			}

			let input: PaymentDetailInput
			if (method === "BANK") {
				input = {
					method: "BANK",
					label: label.trim() || undefined,
					accountName: accountName.trim(),
					accountNumber: accountNumber.trim(),
					bankName: bankName.trim(),
					bankCode: bankCode.trim() || undefined,
				}
			} else {
				input = {
					method: "MOMO",
					label: label.trim() || undefined,
					accountName: accountName.trim() || undefined,
					momoNetwork,
					phone: phone.trim(),
				}
			}
			return addSupplierPaymentDetail(supplierId, input)
		},
		onSuccess: async () => {
			toast.success(isEdit ? "Payment detail updated" : "Payment detail added")
			await queryClient.invalidateQueries({ queryKey: supplierKeys.byId(supplierId) })
			onOpenChange(false)
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
		saveMutation.mutate()
	}

	const effectiveMethod = isEdit && detail ? detail.method : method

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>{isEdit ? "Edit payment detail" : "Add payment detail"}</DialogTitle>
					<DialogDescription>
						Bank or mobile-money destinations are used when paying this supplier. Numbers stay
						masked in lists and show in full only here.
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="grid gap-4">
					<div className="grid gap-1.5">
						<Label htmlFor="payment-detail-method">Method</Label>
						<Select
							value={effectiveMethod}
							onValueChange={(value) => setMethod(value as "BANK" | "MOMO")}
							disabled={isEdit}
						>
							<SelectTrigger id="payment-detail-method" className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="BANK">Bank transfer</SelectItem>
								<SelectItem value="MOMO">Mobile money</SelectItem>
							</SelectContent>
						</Select>
					</div>

					<div className="grid gap-1.5">
						<Label htmlFor="payment-detail-label">
							Label <span className="font-normal text-muted-foreground">(optional)</span>
						</Label>
						<Input
							id="payment-detail-label"
							maxLength={80}
							placeholder={effectiveMethod === "BANK" ? "Main account" : "MTN wallet"}
							value={label}
							onChange={(event) => setLabel(event.target.value)}
						/>
					</div>

					{effectiveMethod === "BANK" ? (
						<>
							<div className="grid gap-1.5">
								<Label htmlFor="payment-detail-account-name">Account name</Label>
								<Input
									id="payment-detail-account-name"
									required
									maxLength={120}
									value={accountName}
									onChange={(event) => setAccountName(event.target.value)}
								/>
							</div>

							<div className="grid gap-1.5">
								<Label htmlFor="payment-detail-account-number">Account number</Label>
								<Input
									id="payment-detail-account-number"
									required
									minLength={4}
									maxLength={40}
									className="font-mono"
									value={accountNumber}
									onChange={(event) => setAccountNumber(event.target.value)}
								/>
								{isEdit ? (
									<p className="text-xs text-muted-foreground">
										Saving this forgets the Paystack recipient; the next transfer creates a new one.
									</p>
								) : null}
							</div>

							<div className="grid gap-1.5">
								<Label htmlFor="payment-detail-bank">Bank</Label>
								<Input
									id="payment-detail-bank"
									required
									maxLength={120}
									value={bankName}
									onChange={(event) => setBankName(event.target.value)}
								/>
							</div>

							<div className="grid gap-1.5">
								<Label htmlFor="payment-detail-bank-code">
									Bank code <span className="font-normal text-muted-foreground">(optional)</span>
								</Label>
								<Input
									id="payment-detail-bank-code"
									maxLength={40}
									className="font-mono"
									value={bankCode}
									onChange={(event) => setBankCode(event.target.value)}
								/>
								<p className="text-xs text-muted-foreground">
									Paystack GHIPSS code, e.g. 058 for Guaranty Trust Bank.
								</p>
							</div>
						</>
					) : (
						<>
							<div className="grid gap-4 sm:grid-cols-2">
								<div className="grid gap-1.5">
									<Label htmlFor="payment-detail-network">Network</Label>
									<Select
										value={momoNetwork}
										onValueChange={(value) => setMomoNetwork(value as SupplierMomoNetwork)}
									>
										<SelectTrigger id="payment-detail-network" className="w-full">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="MTN">MTN MoMo</SelectItem>
											<SelectItem value="VOD">Telecel Cash</SelectItem>
											<SelectItem value="ATL">AirtelTigo Money</SelectItem>
										</SelectContent>
									</Select>
								</div>

								<div className="grid gap-1.5">
									<Label htmlFor="payment-detail-phone">Phone</Label>
									<Input
										id="payment-detail-phone"
										type="tel"
										required
										minLength={6}
										maxLength={20}
										placeholder="024 123 4567"
										value={phone}
										onChange={(event) => setPhone(event.target.value)}
									/>
									{isEdit ? (
										<p className="text-xs text-muted-foreground">
											Saving this forgets the Paystack recipient; the next transfer creates a new
											one.
										</p>
									) : null}
								</div>
							</div>

							<div className="grid gap-1.5">
								<Label htmlFor="payment-detail-momo-name">
									Account name <span className="font-normal text-muted-foreground">(optional)</span>
								</Label>
								<Input
									id="payment-detail-momo-name"
									maxLength={120}
									value={accountName}
									onChange={(event) => setAccountName(event.target.value)}
								/>
							</div>
						</>
					)}

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
							{saveMutation.isPending ? "Saving…" : isEdit ? "Save changes" : "Add detail"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
