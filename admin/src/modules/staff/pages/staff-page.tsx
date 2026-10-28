import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { getRouteApi } from "@tanstack/react-router"
import { PlusIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { ConfirmDialog } from "#/components/common/confirm-dialog"
import { PageHeader } from "#/components/common/page-header"
import { Button } from "#/components/ui/button"
import { Input } from "#/components/ui/input"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select"
import { useBranch } from "#/lib/branch-context"
import { branchLabelFor } from "#/lib/branch-label"
import { useDebouncedValue } from "#/lib/hooks"
import { hasPermission } from "#/lib/role"
import { toastApiError } from "#/lib/toast"
import { staffKeys } from "../api/keys"
import {
	deactivateStaff,
	reactivateStaff,
	resetStaffPassword,
	resetStaffPin,
	staffListOptions,
} from "../api/staff"
import { CreateStaffDialog } from "../components/create-staff-dialog"
import { type Credentials, CredentialsDialog } from "../components/credentials-dialog"
import { EditStaffDialog } from "../components/edit-staff-dialog"
import { StaffTable } from "../components/staff-table"
import type { Staff } from "../types"

// The page lives outside `routes/`, so it reads the parent route's context through the router
// API instead of `Route.useRouteContext()`.
const authenticatedRoute = getRouteApi("/_authenticated")

const PAGE_SIZE = 50

export function StaffPage() {
	const { session } = authenticatedRoute.useRouteContext()
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
	const [credentials, setCredentials] = useState<Credentials | null>(null)
	const [confirmAction, setConfirmAction] = useState<{
		kind: "deactivate" | "reactivate" | "reset" | "reset-pin"
		staff: Staff
	} | null>(null)

	const staffQuery = useQuery(
		staffListOptions({
			role: roleFilter === "ALL" ? undefined : (roleFilter as Staff["role"]),
			includeInactive: statusFilter === "all",
			search: debouncedSearch || undefined,
			branchId: activeBranchId ?? undefined,
			limit: PAGE_SIZE,
			offset,
		}),
	)

	const staff = staffQuery.data?.staff ?? []
	const total = staffQuery.data?.total ?? 0
	const branchLabel = (branchId: string | null) =>
		branchId ? branchLabelFor(branches, { id: branchId }) : "Global"

	// Managers may only reset cashier PINs; admins may reset anyone's.
	const canResetPinFor = (member: Staff) =>
		canSetPin && member.isActive && (isAdmin || member.role === "CASHIER")

	const resetMutation = useMutation({
		mutationFn: (staffId: string) => resetStaffPassword(staffId),
		onSuccess: async (data, staffId) => {
			const target = staff.find((member) => member.id === staffId)
			setCredentials({
				title: "Password reset",
				email: target?.email ?? "",
				staffId: target?.staffId ?? null,
				password: data.temporaryPassword,
				invitationSent: data.invitationSent,
			})
			setConfirmAction(null)
			await queryClient.invalidateQueries({ queryKey: staffKeys.all })
		},
		onError: (error) => {
			setConfirmAction(null)
			toastApiError(error)
		},
	})

	const resetPinMutation = useMutation({
		mutationFn: (staffId: string) => resetStaffPin(staffId),
		onSuccess: async (data, staffId) => {
			const target = staff.find((member) => member.id === staffId)
			setCredentials({
				title: "PIN reset",
				email: target?.email ?? "",
				staffId: data.staffId,
				pin: data.temporaryPin,
				invitationSent: data.invitationSent,
			})
			setConfirmAction(null)
			await queryClient.invalidateQueries({ queryKey: staffKeys.all })
		},
		onError: (error) => {
			setConfirmAction(null)
			toastApiError(error)
		},
	})

	const setActiveMutation = useMutation({
		mutationFn: ({ staffId, active }: { staffId: string; active: boolean }) =>
			active ? reactivateStaff(staffId) : deactivateStaff(staffId),
		onSuccess: async (_data, variables) => {
			toast.success(variables.active ? "Staff reactivated" : "Staff deactivated")
			setConfirmAction(null)
			await queryClient.invalidateQueries({ queryKey: staffKeys.all })
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

			<StaffTable
				staff={staff}
				total={total}
				limit={PAGE_SIZE}
				offset={offset}
				isLoading={staffQuery.isLoading}
				isError={staffQuery.isError}
				branchLabel={branchLabel}
				currentUserId={session.user.id}
				canUpdate={canUpdate}
				canResetPassword={canResetPassword}
				canResetPinFor={canResetPinFor}
				onOffsetChange={setOffset}
				onEdit={setEditStaff}
				onResetPassword={(member) => setConfirmAction({ kind: "reset", staff: member })}
				onResetPin={(member) => setConfirmAction({ kind: "reset-pin", staff: member })}
				onToggleActive={(member) =>
					setConfirmAction({
						kind: member.isActive ? "deactivate" : "reactivate",
						staff: member,
					})
				}
			/>

			{canCreate ? (
				<CreateStaffDialog
					open={createOpen}
					onOpenChange={setCreateOpen}
					session={session}
					onCreated={(result) =>
						setCredentials({
							title: "Account created",
							email: result.staff.email,
							staffId: result.staff.staffId,
							password: result.temporaryPassword,
							pin: result.temporaryPin,
							invitationSent: result.invitationSent,
						})
					}
				/>
			) : null}

			{editStaff ? (
				<EditStaffDialog staff={editStaff} onClose={() => setEditStaff(null)} isAdmin={isAdmin} />
			) : null}

			{credentials ? (
				<CredentialsDialog credentials={credentials} onClose={() => setCredentials(null)} />
			) : null}

			<ConfirmDialog
				open={confirmAction !== null}
				onOpenChange={(open) => !open && setConfirmAction(null)}
				title={
					confirmAction?.kind === "reset"
						? `Reset password for ${confirmAction.staff.name}?`
						: confirmAction?.kind === "reset-pin"
							? `Reset PIN for ${confirmAction.staff.name}?`
							: confirmAction?.kind === "deactivate"
								? `Deactivate ${confirmAction.staff.name}?`
								: `Reactivate ${confirmAction?.staff.name}?`
				}
				description={
					confirmAction?.kind === "reset"
						? "A new temporary password is generated, all their sessions are signed out, and they must choose a new password at next sign-in."
						: confirmAction?.kind === "reset-pin"
							? "A new temporary PIN is generated, every terminal binding is revoked, and they must choose a new PIN at next till sign-in. The PIN is emailed and shown once."
							: confirmAction?.kind === "deactivate"
								? "They are signed out immediately and cannot sign in until reactivated."
								: "They can sign in again with their existing password."
				}
				confirmLabel={
					confirmAction?.kind === "reset"
						? "Reset password"
						: confirmAction?.kind === "reset-pin"
							? "Reset PIN"
							: confirmAction?.kind === "deactivate"
								? "Deactivate"
								: "Reactivate"
				}
				destructive={confirmAction?.kind !== "reactivate"}
				pending={
					resetMutation.isPending || resetPinMutation.isPending || setActiveMutation.isPending
				}
				onConfirm={() => {
					if (!confirmAction) return
					if (confirmAction.kind === "reset") resetMutation.mutate(confirmAction.staff.id)
					else if (confirmAction.kind === "reset-pin")
						resetPinMutation.mutate(confirmAction.staff.id)
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
