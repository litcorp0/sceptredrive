import { formatBranchLabel, type Role } from "@sceptre/shared"
import { useMutation, useQueryClient } from "@tanstack/react-query"
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select"
import { useBranch } from "#/lib/branch-context"
import { toastApiError } from "#/lib/toast"
import { staffKeys } from "../api/keys"
import { updateStaff } from "../api/staff"
import type { Staff } from "../types"

/**
 * Edit name, phone, and (admin only) role and branch. Only changed fields are sent, so a manager
 * editing a name can never alter a role or branch by accident.
 */
export function EditStaffDialog({
	staff,
	onClose,
	isAdmin,
}: {
	staff: Staff
	onClose: () => void
	isAdmin: boolean
}) {
	const queryClient = useQueryClient()
	const { branches } = useBranch()

	const [name, setName] = useState(staff.name)
	const [phone, setPhone] = useState(staff.phone ?? "")
	const [role, setRole] = useState<Role>(staff.role)
	const [branchId, setBranchId] = useState(staff.branchId ?? "")
	const [formError, setFormError] = useState<string | null>(null)

	const needsBranch = role !== "ADMIN"

	const updateMutation = useMutation({
		mutationFn: () => {
			const input: Record<string, unknown> = {}
			if (name !== staff.name) input.name = name
			if (phone !== (staff.phone ?? "")) input.phone = phone
			if (isAdmin && role !== staff.role) input.role = role
			if (isAdmin && needsBranch && branchId !== (staff.branchId ?? "")) input.branchId = branchId
			return updateStaff(staff.id, input)
		},
		onSuccess: async () => {
			toast.success("Staff updated")
			onClose()
			await queryClient.invalidateQueries({ queryKey: staffKeys.all })
		},
		onError: (error) => {
			setFormError(null)
			toastApiError(error)
		},
	})

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		if (isAdmin && needsBranch && !branchId) {
			setFormError("Choose a branch for this account.")
			return
		}
		updateMutation.mutate()
	}

	return (
		<Dialog open onOpenChange={(next) => !next && onClose()}>
			<DialogContent className="sm:max-w-sm">
				<DialogHeader>
					<DialogTitle>Edit {staff.name}</DialogTitle>
					<DialogDescription>
						{staff.staffId ? `${staff.staffId} · ` : ""}
						{staff.email}
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="grid gap-4">
					<div className="grid gap-1.5">
						<Label htmlFor="edit-name">Name</Label>
						<Input
							id="edit-name"
							required
							minLength={2}
							value={name}
							onChange={(event) => setName(event.target.value)}
						/>
					</div>

					<div className="grid gap-1.5">
						<Label htmlFor="edit-phone">Phone</Label>
						<Input
							id="edit-phone"
							value={phone}
							onChange={(event) => setPhone(event.target.value)}
						/>
					</div>

					{isAdmin ? (
						<div className="grid grid-cols-2 gap-3">
							<div className="grid gap-1.5">
								<Label htmlFor="edit-role">Role</Label>
								<Select value={role} onValueChange={(value) => setRole(value as Role)}>
									<SelectTrigger id="edit-role" className="w-full">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="ADMIN">Admin</SelectItem>
										<SelectItem value="MANAGER">Manager</SelectItem>
										<SelectItem value="CASHIER">Cashier</SelectItem>
									</SelectContent>
								</Select>
							</div>
							{needsBranch ? (
								<div className="grid gap-1.5">
									<Label htmlFor="edit-branch">Branch</Label>
									<Select value={branchId} onValueChange={setBranchId}>
										<SelectTrigger id="edit-branch" className="w-full">
											<SelectValue placeholder="Select" />
										</SelectTrigger>
										<SelectContent>
											{branches
												.filter((branch) => branch.isActive)
												.map((branch) => (
													<SelectItem key={branch.id} value={branch.id}>
														{formatBranchLabel(branch)}
													</SelectItem>
												))}
										</SelectContent>
									</Select>
								</div>
							) : null}
						</div>
					) : null}

					{formError ? (
						<p role="alert" className="text-sm text-destructive">
							{formError}
						</p>
					) : null}

					<DialogFooter>
						<Button type="button" variant="outline" onClick={onClose}>
							Cancel
						</Button>
						<Button type="submit" disabled={updateMutation.isPending}>
							{updateMutation.isPending ? "Saving…" : "Save changes"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
