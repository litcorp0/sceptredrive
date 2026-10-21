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
import { Textarea } from "#/components/ui/textarea"
import { ApiError, api } from "#/lib/api"
import type { Supplier } from "#/lib/api-types"
import { toastApiError } from "#/lib/toast"

export function SupplierFormDialog({
	open,
	onOpenChange,
	supplier = null,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	/** When set, the dialog edits this supplier instead of creating one. */
	supplier?: Supplier | null
}) {
	const queryClient = useQueryClient()
	const isEdit = supplier !== null

	const [name, setName] = useState("")
	const [contactName, setContactName] = useState("")
	const [phone, setPhone] = useState("")
	const [email, setEmail] = useState("")
	const [address, setAddress] = useState("")
	const [tin, setTin] = useState("")
	const [vatNumber, setVatNumber] = useState("")
	const [paymentTermDays, setPaymentTermDays] = useState("0")
	const [notes, setNotes] = useState("")
	const [formError, setFormError] = useState<string | null>(null)

	useEffect(() => {
		if (!open) return
		setName(supplier?.name ?? "")
		setContactName(supplier?.contactName ?? "")
		setPhone(supplier?.phone ?? "")
		setEmail(supplier?.email ?? "")
		setAddress(supplier?.address ?? "")
		setTin(supplier?.tin ?? "")
		setVatNumber(supplier?.vatNumber ?? "")
		setPaymentTermDays(String(supplier?.paymentTermDays ?? 0))
		setNotes(supplier?.notes ?? "")
		setFormError(null)
	}, [open, supplier])

	const saveMutation = useMutation({
		mutationFn: () => {
			const terms = Number.parseInt(paymentTermDays, 10)
			const input = {
				name: name.trim(),
				contactName: contactName.trim() || undefined,
				phone: phone.trim() || undefined,
				email: email.trim() || undefined,
				address: address.trim() || undefined,
				tin: tin.trim() || undefined,
				vatNumber: vatNumber.trim() || undefined,
				paymentTermDays: terms,
				notes: notes.trim() || undefined,
			}
			if (isEdit && supplier) {
				return api.suppliers.update(supplier.id, {
					...input,
					// Empty optional fields clear the stored value on edit.
					contactName: contactName.trim() || null,
					phone: phone.trim() || null,
					email: email.trim() || null,
					address: address.trim() || null,
					tin: tin.trim() || null,
					vatNumber: vatNumber.trim() || null,
					notes: notes.trim() || null,
				})
			}
			return api.suppliers.create(input)
		},
		onSuccess: async (data) => {
			toast.success(
				isEdit
					? `Supplier ${data.supplier.name} updated`
					: `Supplier ${data.supplier.name} created`,
			)
			await queryClient.invalidateQueries({ queryKey: ["suppliers"] })
			await queryClient.invalidateQueries({ queryKey: ["supplier", data.supplier.id] })
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
		const terms = Number.parseInt(paymentTermDays, 10)
		if (!Number.isInteger(terms) || terms < 0 || terms > 365) {
			setFormError("Payment terms must be a whole number of days between 0 and 365.")
			return
		}
		saveMutation.mutate()
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>{isEdit ? "Edit supplier" : "New supplier"}</DialogTitle>
					<DialogDescription>
						Suppliers are shared across branches; invoices and payments stay branch-scoped.
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="grid gap-4">
					<div className="grid gap-1.5">
						<Label htmlFor="supplier-name">Name</Label>
						<Input
							id="supplier-name"
							required
							maxLength={120}
							value={name}
							onChange={(event) => setName(event.target.value)}
						/>
					</div>

					<div className="grid gap-4 sm:grid-cols-2">
						<div className="grid gap-1.5">
							<Label htmlFor="supplier-contact">
								Contact <span className="font-normal text-muted-foreground">(optional)</span>
							</Label>
							<Input
								id="supplier-contact"
								maxLength={120}
								value={contactName}
								onChange={(event) => setContactName(event.target.value)}
							/>
						</div>

						<div className="grid gap-1.5">
							<Label htmlFor="supplier-phone">
								Phone <span className="font-normal text-muted-foreground">(optional)</span>
							</Label>
							<Input
								id="supplier-phone"
								type="tel"
								minLength={6}
								maxLength={20}
								pattern="[+0-9][0-9 ()\-]{5,19}"
								title="Enter a Ghana number like 024 123 4567 or +233 24 123 4567"
								placeholder="024 123 4567"
								value={phone}
								onChange={(event) => setPhone(event.target.value)}
							/>
							<p className="text-xs text-muted-foreground">
								National (024…) or international (+233…); the server normalises it.
							</p>
						</div>
					</div>

					<div className="grid gap-4 sm:grid-cols-2">
						<div className="grid gap-1.5">
							<Label htmlFor="supplier-email">
								Email <span className="font-normal text-muted-foreground">(optional)</span>
							</Label>
							<Input
								id="supplier-email"
								type="email"
								maxLength={160}
								value={email}
								onChange={(event) => setEmail(event.target.value)}
							/>
						</div>

						<div className="grid gap-1.5">
							<Label htmlFor="supplier-terms">Payment terms (days)</Label>
							<Input
								id="supplier-terms"
								type="number"
								min={0}
								max={365}
								step={1}
								required
								value={paymentTermDays}
								onChange={(event) => setPaymentTermDays(event.target.value)}
							/>
							<p className="text-xs text-muted-foreground">
								Used to default invoice due dates. 0 means due on receipt.
							</p>
						</div>
					</div>

					<div className="grid gap-4 sm:grid-cols-2">
						<div className="grid gap-1.5">
							<Label htmlFor="supplier-tin">
								TIN <span className="font-normal text-muted-foreground">(optional)</span>
							</Label>
							<Input
								id="supplier-tin"
								maxLength={40}
								value={tin}
								onChange={(event) => setTin(event.target.value)}
							/>
						</div>

						<div className="grid gap-1.5">
							<Label htmlFor="supplier-vat">
								VAT number <span className="font-normal text-muted-foreground">(optional)</span>
							</Label>
							<Input
								id="supplier-vat"
								maxLength={40}
								value={vatNumber}
								onChange={(event) => setVatNumber(event.target.value)}
							/>
						</div>
					</div>

					<div className="grid gap-1.5">
						<Label htmlFor="supplier-address">
							Address <span className="font-normal text-muted-foreground">(optional)</span>
						</Label>
						<Textarea
							id="supplier-address"
							rows={2}
							maxLength={300}
							value={address}
							onChange={(event) => setAddress(event.target.value)}
						/>
					</div>

					<div className="grid gap-1.5">
						<Label htmlFor="supplier-notes">
							Notes <span className="font-normal text-muted-foreground">(optional)</span>
						</Label>
						<Textarea
							id="supplier-notes"
							rows={2}
							maxLength={1000}
							value={notes}
							onChange={(event) => setNotes(event.target.value)}
						/>
					</div>

					{formError ? (
						<div role="alert" className="text-sm text-destructive">
							{formError}
						</div>
					) : null}

					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							Cancel
						</Button>
						<Button type="submit" disabled={saveMutation.isPending}>
							{saveMutation.isPending ? "Saving…" : isEdit ? "Save changes" : "Create supplier"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
