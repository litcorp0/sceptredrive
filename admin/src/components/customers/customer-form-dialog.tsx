import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
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
import { Textarea } from "#/components/ui/textarea"
import { ApiError, api } from "#/lib/api"
import type { CustomerListRow } from "#/lib/api-types"
import { useBranch } from "#/lib/branch-context"
import { toastApiError } from "#/lib/toast"

/**
 * The API's duplicate-phone conflict ends with the existing customer id in
 * parentheses (a tested contract); pull it out so the form can link to them.
 */
const DUPLICATE_PHONE = /\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)$/

export function CustomerFormDialog({
	open,
	onOpenChange,
	customer = null,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	/** When set, the dialog edits this customer instead of creating one. */
	customer?: CustomerListRow | null
}) {
	const queryClient = useQueryClient()
	const { branches, activeBranchId, canSelectBranch } = useBranch()
	const isEdit = customer !== null

	const [name, setName] = useState("")
	const [phone, setPhone] = useState("")
	const [email, setEmail] = useState("")
	const [address, setAddress] = useState("")
	const [branchId, setBranchId] = useState("")
	const [formError, setFormError] = useState<string | null>(null)

	useEffect(() => {
		if (!open) return
		setName(customer?.name ?? "")
		setPhone(customer?.phone ?? "")
		setEmail(customer?.email ?? "")
		setAddress(customer?.address ?? "")
		setBranchId(activeBranchId ?? branches[0]?.id ?? "")
		setFormError(null)
	}, [open, customer, activeBranchId, branches])

	const saveMutation = useMutation({
		mutationFn: () => {
			const input = {
				name: name.trim(),
				phone: phone.trim(),
				email: email.trim() || null,
				address: address.trim() || null,
			}
			return isEdit && customer
				? api.customers.update(customer.id, input)
				: api.customers.create({
						...input,
						email: input.email ?? undefined,
						address: input.address ?? undefined,
						branchId: canSelectBranch ? branchId || undefined : undefined,
					})
		},
		onSuccess: async (data) => {
			toast.success(
				isEdit
					? `Customer ${data.customer.name} updated`
					: `Customer ${data.customer.name} created`,
			)
			await queryClient.invalidateQueries({ queryKey: ["customers"] })
			await queryClient.invalidateQueries({ queryKey: ["customer", data.customer.id] })
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
		if (!isEdit && canSelectBranch && !branchId) {
			setFormError("Choose the branch that owns this customer.")
			return
		}
		saveMutation.mutate()
	}

	const duplicateMatch = formError ? DUPLICATE_PHONE.exec(formError) : null

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>{isEdit ? "Edit customer" : "New customer"}</DialogTitle>
					<DialogDescription>
						{isEdit
							? "Changes apply everywhere this customer is used."
							: "Customers are shared across branches; credit and repayments stay per branch."}
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="grid gap-4">
					<div className="grid gap-1.5">
						<Label htmlFor="customer-name">Name</Label>
						<Input
							id="customer-name"
							required
							maxLength={120}
							value={name}
							onChange={(event) => setName(event.target.value)}
						/>
					</div>

					<div className="grid gap-1.5">
						<Label htmlFor="customer-phone">Phone</Label>
						<Input
							id="customer-phone"
							required
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
							National (024…) or international (+233…) format; used to find the customer.
						</p>
					</div>

					<div className="grid gap-1.5">
						<Label htmlFor="customer-email">
							Email <span className="font-normal text-muted-foreground">(optional)</span>
						</Label>
						<Input
							id="customer-email"
							type="email"
							maxLength={160}
							value={email}
							onChange={(event) => setEmail(event.target.value)}
						/>
					</div>

					<div className="grid gap-1.5">
						<Label htmlFor="customer-address">
							Address <span className="font-normal text-muted-foreground">(optional)</span>
						</Label>
						<Textarea
							id="customer-address"
							rows={2}
							maxLength={300}
							value={address}
							onChange={(event) => setAddress(event.target.value)}
						/>
					</div>

					{!isEdit && canSelectBranch ? (
						<div className="grid gap-1.5">
							<Label htmlFor="customer-branch">Branch</Label>
							<Select value={branchId} onValueChange={setBranchId}>
								<SelectTrigger id="customer-branch" className="w-full">
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
							<p className="text-xs text-muted-foreground">
								The customer is created at this branch.
							</p>
						</div>
					) : null}

					{formError ? (
						<div role="alert" className="text-sm text-destructive">
							<p>{formError}</p>
							{duplicateMatch ? (
								<Button variant="link" size="sm" asChild className="h-auto px-0">
									<Link
										to="/customers/$id"
										params={{ id: duplicateMatch[1] ?? "" }}
										onClick={() => onOpenChange(false)}
									>
										Open the existing customer
									</Link>
								</Button>
							) : null}
						</div>
					) : null}

					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							Cancel
						</Button>
						<Button type="submit" disabled={saveMutation.isPending}>
							{saveMutation.isPending ? "Saving…" : isEdit ? "Save changes" : "Create customer"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
