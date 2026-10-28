import { useMutation, useQueryClient } from "@tanstack/react-query"
import { type FormEvent, useEffect, useState } from "react"
import { toast } from "sonner"
import { ConfirmDialog } from "#/components/common/confirm-dialog"
import { Button } from "#/components/ui/button"
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"
import { toastApiError } from "#/lib/toast"
import { deactivateBranch, updateBranch } from "../api/branches"
import { branchKeys } from "../api/keys"
import type { Branch } from "../types"

/**
 * The detail screen's edit form. It stays a form rather than a dialog because the pre-Phase-8
 * screen always showed it inline; extracting it keeps the page a composition root without
 * changing how anything looks or behaves.
 */
export function EditBranchForm({
	branch,
	isAdmin,
	canDeactivate,
}: {
	branch: Branch
	isAdmin: boolean
	canDeactivate: boolean
}) {
	const queryClient = useQueryClient()

	const [name, setName] = useState("")
	const [city, setCity] = useState("")
	const [area, setArea] = useState("")
	const [address, setAddress] = useState("")
	const [phone, setPhone] = useState("")
	const [formError, setFormError] = useState<string | null>(null)
	const [confirmOpen, setConfirmOpen] = useState(false)

	useEffect(() => {
		setName(branch.name)
		setCity(branch.city)
		setArea(branch.area ?? "")
		setAddress(branch.address ?? "")
		setPhone(branch.phone ?? "")
	}, [branch])

	const updateMutation = useMutation({
		mutationFn: () => {
			const input: Record<string, string> = {}
			if (name !== branch.name) input.name = name
			if (isAdmin && city !== branch.city) input.city = city
			if (isAdmin && area !== (branch.area ?? "")) input.area = area
			if (address !== (branch.address ?? "")) input.address = address
			if (phone !== (branch.phone ?? "")) input.phone = phone
			return updateBranch(branch.id, input)
		},
		onSuccess: async () => {
			toast.success("Branch updated")
			await queryClient.invalidateQueries({ queryKey: branchKeys.all })
		},
		onError: (error) => {
			setFormError(null)
			toastApiError(error)
		},
	})

	const deactivateMutation = useMutation({
		mutationFn: () => deactivateBranch(branch.id),
		onSuccess: async () => {
			toast.success("Branch deactivated")
			setConfirmOpen(false)
			await queryClient.invalidateQueries({ queryKey: branchKeys.all })
		},
		onError: (error) => {
			setConfirmOpen(false)
			toastApiError(error)
		},
	})

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		setFormError(null)
		updateMutation.mutate()
	}

	return (
		<>
			<form onSubmit={handleSubmit} className="grid gap-4 rounded-lg border bg-card p-5">
				<div className="grid gap-1.5">
					<Label htmlFor="name">Name</Label>
					<Input
						id="name"
						required
						minLength={2}
						value={name}
						onChange={(event) => setName(event.target.value)}
					/>
				</div>

				<div className="grid grid-cols-2 gap-3">
					<div className="grid gap-1.5">
						<Label htmlFor="city">City</Label>
						<Input
							id="city"
							required
							disabled={!isAdmin}
							value={city}
							onChange={(event) => setCity(event.target.value)}
						/>
					</div>
					<div className="grid gap-1.5">
						<Label htmlFor="area">Area</Label>
						<Input
							id="area"
							disabled={!isAdmin}
							value={area}
							onChange={(event) => setArea(event.target.value)}
						/>
					</div>
				</div>

				<div className="grid gap-1.5">
					<Label htmlFor="address">Address</Label>
					<Input
						id="address"
						value={address}
						onChange={(event) => setAddress(event.target.value)}
					/>
				</div>

				<div className="grid gap-1.5">
					<Label htmlFor="phone">Phone</Label>
					<Input id="phone" value={phone} onChange={(event) => setPhone(event.target.value)} />
				</div>

				{formError ? (
					<p role="alert" className="text-sm text-destructive">
						{formError}
					</p>
				) : null}

				<div className="flex items-center justify-between pt-1">
					{canDeactivate && branch.isActive ? (
						<Button
							type="button"
							variant="outline"
							className="text-destructive"
							onClick={() => setConfirmOpen(true)}
						>
							Deactivate branch
						</Button>
					) : (
						<span />
					)}
					<Button type="submit" disabled={updateMutation.isPending}>
						{updateMutation.isPending ? "Saving…" : "Save changes"}
					</Button>
				</div>
			</form>

			<ConfirmDialog
				open={confirmOpen}
				onOpenChange={setConfirmOpen}
				title={`Deactivate ${branch.name} (${branch.code})?`}
				description="The branch stays visible in reports and history, but new terminals cannot be added and staff cannot be assigned to it. This can be reversed by an administrator in the database."
				confirmLabel="Deactivate"
				destructive
				pending={deactivateMutation.isPending}
				onConfirm={() => deactivateMutation.mutate()}
			/>
		</>
	)
}
