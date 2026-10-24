import type { Role } from "@sceptre/shared"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { MoreHorizontalIcon, PlusIcon } from "lucide-react"
import { type FormEvent, useEffect, useState } from "react"
import { toast } from "sonner"
import { ConfirmDialog } from "#/components/common/confirm-dialog"
import { CopyButton } from "#/components/common/copy-button"
import { PageHeader } from "#/components/common/page-header"
import { Pagination } from "#/components/common/pagination"
import { ActiveBadge, RoleBadge } from "#/components/common/status-badge"
import { TableMessage } from "#/components/common/table-message"
import { PinDialog } from "#/components/staff/pin-dialog"
import { PinStatusBadge } from "#/components/staff/pin-status-badge"
import { Button } from "#/components/ui/button"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu"
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table"
import { api } from "#/lib/api"
import type { Staff } from "#/lib/api-types"
import { useBranch } from "#/lib/branch-context"
import { useDebouncedValue } from "#/lib/hooks"
import { hasPermission } from "#/lib/role"
import { toastApiError } from "#/lib/toast"

export const Route = createFileRoute("/_authenticated/staff")({
	component: StaffPage,
})

const PAGE_SIZE = 50

interface Credentials {
	title: string
	email: string
	password: string
	invitationSent: boolean
}

function StaffPage() {
	const { session } = Route.useRouteContext()
	const { activeBranchId, branches } = useBranch()
	const queryClient = useQueryClient()

	const isAdmin = session.user.role === "ADMIN"
	const canCreate = hasPermission(session.user.role, "staff.create")
	const canResetPassword = hasPermission(session.user.role, "staff.reset-password")
	const canSetPin = hasPermission(session.user.role, "staff.pin.reset")
	const canUpdate = hasPermission(session.user.role, "staff.update")

	const [roleFilter, setRoleFilter] = useState<string>("ALL")
	const [statusFilter, setStatusFilter] = useState<string>("active")
	const [search, setSearch] = useState("")
	const [offset, setOffset] = useState(0)
	const debouncedSearch = useDebouncedValue(search, 300)

	// Reset pagination whenever the filters change (derived state, no effect).
	const filterSignature = JSON.stringify([
		roleFilter,
		statusFilter,
		debouncedSearch,
		activeBranchId,
	])
	const [lastFilterSignature, setLastFilterSignature] = useState(filterSignature)
	if (filterSignature !== lastFilterSignature) {
		setLastFilterSignature(filterSignature)
		setOffset(0)
	}

	const [createOpen, setCreateOpen] = useState(false)
	const [editStaff, setEditStaff] = useState<Staff | null>(null)
	const [pinStaff, setPinStaff] = useState<Staff | null>(null)
	const [credentials, setCredentials] = useState<Credentials | null>(null)
	const [confirmAction, setConfirmAction] = useState<{
		kind: "deactivate" | "reactivate" | "reset"
		staff: Staff
	} | null>(null)

	const staffQuery = useQuery({
		queryKey: [
			"staff",
			{
				role: roleFilter,
				status: statusFilter,
				search: debouncedSearch,
				branchId: activeBranchId ?? undefined,
				offset,
			},
		],
		queryFn: () =>
			api.staff.list({
				role: roleFilter === "ALL" ? undefined : (roleFilter as Role),
				includeInactive: statusFilter === "all",
				search: debouncedSearch || undefined,
				branchId: activeBranchId ?? undefined,
				limit: PAGE_SIZE,
				offset,
			}),
	})

	const staff = staffQuery.data?.staff ?? []
	const total = staffQuery.data?.total ?? 0
	const branchCode = (branchId: string | null) =>
		branchId ? (branches.find((branch) => branch.id === branchId)?.code ?? "—") : "Global"

	// Managers may only reset cashier PINs; admins may reset anyone's.
	const canResetPinFor = (member: Staff) =>
		canSetPin && member.isActive && (isAdmin || member.role === "CASHIER")

	const resetMutation = useMutation({
		mutationFn: (staffId: string) => api.staff.resetPassword(staffId),
		onSuccess: async (data, staffId) => {
			const target = staff.find((member) => member.id === staffId)
			setCredentials({
				title: "Password reset",
				email: target?.email ?? "",
				password: data.temporaryPassword,
				invitationSent: data.invitationSent,
			})
			setConfirmAction(null)
			await queryClient.invalidateQueries({ queryKey: ["staff"] })
		},
		onError: (error) => {
			setConfirmAction(null)
			toastApiError(error)
		},
	})

	const setActiveMutation = useMutation({
		mutationFn: ({ staffId, active }: { staffId: string; active: boolean }) =>
			active ? api.staff.reactivate(staffId) : api.staff.deactivate(staffId),
		onSuccess: async (_data, variables) => {
			toast.success(variables.active ? "Staff reactivated" : "Staff deactivated")
			setConfirmAction(null)
			await queryClient.invalidateQueries({ queryKey: ["staff"] })
		},
		onError: (error) => {
			setConfirmAction(null)
			toastApiError(error)
		},
	})

	return (
		<div>
			<PageHeader
				title="Staff"
				description="Manager and cashier accounts. Cashiers sign in on the POS only."
				actions={
					canCreate ? (
						<Button size="sm" onClick={() => setCreateOpen(true)}>
							<PlusIcon className="size-4" />
							New staff
						</Button>
					) : undefined
				}
			/>

			<div className="mb-4 flex flex-wrap items-center gap-2">
				<Input
					placeholder="Search name, email, or staff ID"
					className="h-8 w-64"
					value={search}
					onChange={(event) => setSearch(event.target.value)}
				/>
				<Select value={roleFilter} onValueChange={setRoleFilter}>
					<SelectTrigger size="sm" className="w-36" aria-label="Role filter">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="ALL">All roles</SelectItem>
						<SelectItem value="ADMIN">Admin</SelectItem>
						<SelectItem value="MANAGER">Manager</SelectItem>
						<SelectItem value="CASHIER">Cashier</SelectItem>
					</SelectContent>
				</Select>
				<Select value={statusFilter} onValueChange={setStatusFilter}>
					<SelectTrigger size="sm" className="w-40" aria-label="Status filter">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="active">Active only</SelectItem>
						<SelectItem value="all">Include inactive</SelectItem>
					</SelectContent>
				</Select>
			</div>

			<div className="rounded-lg border bg-card">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="w-24">Staff ID</TableHead>
							<TableHead>Name</TableHead>
							<TableHead>Email</TableHead>
							<TableHead className="w-28">Role</TableHead>
							<TableHead className="w-24">Branch</TableHead>
							<TableHead className="w-24">PIN</TableHead>
							<TableHead className="w-32">Status</TableHead>
							<TableHead className="w-16" />
						</TableRow>
					</TableHeader>
					<TableBody>
						{staffQuery.isLoading ? (
							<TableMessage colSpan={8}>Loading staff…</TableMessage>
						) : staffQuery.isError ? (
							<TableMessage colSpan={8} tone="error">
								Couldn't load staff.
							</TableMessage>
						) : staff.length === 0 ? (
							<TableMessage colSpan={8}>No staff match these filters.</TableMessage>
						) : (
							staff.map((member) => (
								<TableRow key={member.id}>
									<TableCell className="font-mono text-xs">{member.staffId ?? "—"}</TableCell>
									<TableCell className="font-medium">{member.name}</TableCell>
									<TableCell className="text-muted-foreground">{member.email}</TableCell>
									<TableCell>
										<RoleBadge role={member.role} />
									</TableCell>
									<TableCell className="font-mono text-xs text-muted-foreground">
										{branchCode(member.branchId)}
									</TableCell>
									<TableCell>
										<PinStatusBadge
											pinVersion={member.pinVersion}
											pinMustChange={member.pinMustChange}
										/>
									</TableCell>
									<TableCell>
										<div className="flex flex-col gap-1">
											<ActiveBadge active={member.isActive} />
											{member.mustChangePassword ? (
												<span className="text-xs text-amber-600">Password change required</span>
											) : null}
										</div>
									</TableCell>
									<TableCell className="text-right">
										<DropdownMenu>
											<DropdownMenuTrigger asChild>
												<Button
													variant="ghost"
													size="icon-sm"
													aria-label={`Actions for ${member.name}`}
												>
													<MoreHorizontalIcon />
												</Button>
											</DropdownMenuTrigger>
											<DropdownMenuContent align="end">
												{canUpdate ? (
													<DropdownMenuItem
														className="cursor-pointer"
														onSelect={() => setEditStaff(member)}
													>
														Edit
													</DropdownMenuItem>
												) : null}
												{canResetPassword ? (
													<DropdownMenuItem
														className="cursor-pointer"
														onSelect={() => setConfirmAction({ kind: "reset", staff: member })}
													>
														Reset password
													</DropdownMenuItem>
												) : null}
												{canResetPinFor(member) ? (
													<DropdownMenuItem
														className="cursor-pointer"
														onSelect={() => setPinStaff(member)}
													>
														Set PIN
													</DropdownMenuItem>
												) : null}
												{canUpdate && member.id !== session.user.id ? (
													member.isActive ? (
														<DropdownMenuItem
															variant="destructive"
															className="cursor-pointer"
															onSelect={() =>
																setConfirmAction({ kind: "deactivate", staff: member })
															}
														>
															Deactivate
														</DropdownMenuItem>
													) : (
														<DropdownMenuItem
															className="cursor-pointer"
															onSelect={() =>
																setConfirmAction({ kind: "reactivate", staff: member })
															}
														>
															Reactivate
														</DropdownMenuItem>
													)
												) : null}
											</DropdownMenuContent>
										</DropdownMenu>
									</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
				<div className="border-t px-3">
					<Pagination total={total} limit={PAGE_SIZE} offset={offset} onOffsetChange={setOffset} />
				</div>
			</div>

			{canCreate ? (
				<CreateStaffDialog
					open={createOpen}
					onOpenChange={setCreateOpen}
					onCreated={(result) =>
						setCredentials({
							title: "Account created",
							email: result.staff.email,
							password: result.temporaryPassword,
							invitationSent: result.invitationSent,
						})
					}
				/>
			) : null}

			{editStaff ? (
				<EditStaffDialog staff={editStaff} onClose={() => setEditStaff(null)} isAdmin={isAdmin} />
			) : null}

			{pinStaff ? <PinDialog staff={pinStaff} onClose={() => setPinStaff(null)} /> : null}

			{credentials ? (
				<CredentialsDialog credentials={credentials} onClose={() => setCredentials(null)} />
			) : null}

			<ConfirmDialog
				open={confirmAction !== null}
				onOpenChange={(open) => !open && setConfirmAction(null)}
				title={
					confirmAction?.kind === "reset"
						? `Reset password for ${confirmAction.staff.name}?`
						: confirmAction?.kind === "deactivate"
							? `Deactivate ${confirmAction.staff.name}?`
							: `Reactivate ${confirmAction?.staff.name}?`
				}
				description={
					confirmAction?.kind === "reset"
						? "A new temporary password is generated, all their sessions are signed out, and they must choose a new password at next sign-in."
						: confirmAction?.kind === "deactivate"
							? "They are signed out immediately and cannot sign in until reactivated."
							: "They can sign in again with their existing password."
				}
				confirmLabel={
					confirmAction?.kind === "reset"
						? "Reset password"
						: confirmAction?.kind === "deactivate"
							? "Deactivate"
							: "Reactivate"
				}
				destructive={confirmAction?.kind !== "reactivate"}
				pending={resetMutation.isPending || setActiveMutation.isPending}
				onConfirm={() => {
					if (!confirmAction) return
					if (confirmAction.kind === "reset") resetMutation.mutate(confirmAction.staff.id)
					else
						setActiveMutation.mutate({
							staffId: confirmAction.staff.id,
							active: confirmAction.kind === "reactivate",
						})
				}}
			/>
		</div>
	)
}

function CredentialsDialog({
	credentials,
	onClose,
}: {
	credentials: Credentials
	onClose: () => void
}) {
	return (
		<Dialog open onOpenChange={(next) => !next && onClose()}>
			<DialogContent className="sm:max-w-sm">
				<DialogHeader>
					<DialogTitle>{credentials.title}</DialogTitle>
					<DialogDescription>
						Share the temporary password with {credentials.email}. It is shown only once
						{credentials.invitationSent ? " and was emailed to them" : ""}. They must change it at
						first sign-in.
					</DialogDescription>
				</DialogHeader>

				<div className="rounded-lg border bg-muted/40 p-4">
					<p className="font-mono text-sm break-all">{credentials.password}</p>
				</div>

				<div className="flex items-center justify-between">
					<CopyButton value={credentials.password} label="Copy password" />
					<Button type="button" onClick={onClose}>
						Done
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	)
}

function CreateStaffDialog({
	open,
	onOpenChange,
	onCreated,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	onCreated: (result: { staff: Staff; temporaryPassword: string; invitationSent: boolean }) => void
}) {
	const queryClient = useQueryClient()
	const { session } = Route.useRouteContext()
	const { branches, canSelectBranch } = useBranch()

	const isAdmin = session.user.role === "ADMIN"
	const roleOptions: Role[] = isAdmin ? ["ADMIN", "MANAGER", "CASHIER"] : ["MANAGER", "CASHIER"]

	const [email, setEmail] = useState("")
	const [name, setName] = useState("")
	const [role, setRole] = useState<Role>(roleOptions[0] ?? "CASHIER")
	const [branchId, setBranchId] = useState(session.user.branchId ?? "")
	const [phone, setPhone] = useState("")
	const [formError, setFormError] = useState<string | null>(null)

	useEffect(() => {
		if (!open) return
		setBranchId(session.user.branchId ?? "")
	}, [open, session.user.branchId])

	const needsBranch = role !== "ADMIN"

	const createMutation = useMutation({
		mutationFn: () =>
			api.staff.create({
				email,
				name,
				role,
				branchId: needsBranch ? branchId : null,
				phone: phone || undefined,
			}),
		onSuccess: async (data) => {
			onOpenChange(false)
			reset()
			onCreated(data)
			await queryClient.invalidateQueries({ queryKey: ["staff"] })
		},
		onError: (error) => {
			setFormError(null)
			toastApiError(error)
		},
	})

	function reset() {
		setEmail("")
		setName("")
		setRole(roleOptions[0] ?? "CASHIER")
		setPhone("")
		setFormError(null)
	}

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		if (needsBranch && !branchId) {
			setFormError("Choose a branch for this account.")
			return
		}
		createMutation.mutate()
	}

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				onOpenChange(next)
				if (!next) reset()
			}}
		>
			<DialogContent className="sm:max-w-sm">
				<DialogHeader>
					<DialogTitle>New staff account</DialogTitle>
					<DialogDescription>
						A temporary password is generated and the account must change it at first sign-in.
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="grid gap-4">
					<div className="grid gap-1.5">
						<Label htmlFor="staff-name">Name</Label>
						<Input
							id="staff-name"
							required
							minLength={2}
							value={name}
							onChange={(event) => setName(event.target.value)}
						/>
					</div>

					<div className="grid gap-1.5">
						<Label htmlFor="staff-email">Email</Label>
						<Input
							id="staff-email"
							type="email"
							required
							value={email}
							onChange={(event) => setEmail(event.target.value)}
						/>
					</div>

					<div className="grid grid-cols-2 gap-3">
						<div className="grid gap-1.5">
							<Label htmlFor="staff-role">Role</Label>
							<Select value={role} onValueChange={(value) => setRole(value as Role)}>
								<SelectTrigger id="staff-role" className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{roleOptions.map((option) => (
										<SelectItem key={option} value={option}>
											{option === "ADMIN" ? "Admin" : option === "MANAGER" ? "Manager" : "Cashier"}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						{needsBranch && canSelectBranch ? (
							<div className="grid gap-1.5">
								<Label htmlFor="staff-branch">Branch</Label>
								<Select value={branchId} onValueChange={setBranchId}>
									<SelectTrigger id="staff-branch" className="w-full">
										<SelectValue placeholder="Select" />
									</SelectTrigger>
									<SelectContent>
										{branches
											.filter((branch) => branch.isActive)
											.map((branch) => (
												<SelectItem key={branch.id} value={branch.id}>
													{branch.code}
												</SelectItem>
											))}
									</SelectContent>
								</Select>
							</div>
						) : null}
					</div>

					<div className="grid gap-1.5">
						<Label htmlFor="staff-phone">Phone</Label>
						<Input
							id="staff-phone"
							value={phone}
							onChange={(event) => setPhone(event.target.value)}
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
						<Button type="submit" disabled={createMutation.isPending}>
							{createMutation.isPending ? "Creating…" : "Create account"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}

function EditStaffDialog({
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
			return api.staff.update(staff.id, input)
		},
		onSuccess: async () => {
			toast.success("Staff updated")
			onClose()
			await queryClient.invalidateQueries({ queryKey: ["staff"] })
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
														{branch.code}
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
