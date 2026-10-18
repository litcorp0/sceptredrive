import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { ArrowLeftIcon } from "lucide-react"
import { type FormEvent, useEffect, useState } from "react"
import { toast } from "sonner"
import { ConfirmDialog } from "#/components/common/confirm-dialog"
import { PageHeader } from "#/components/common/page-header"
import { ActiveBadge } from "#/components/common/status-badge"
import { Button } from "#/components/ui/button"
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"
import { api } from "#/lib/api"
import { hasPermission } from "#/lib/role"
import { toastApiError } from "#/lib/toast"

export const Route = createFileRoute("/_authenticated/branches/$id")({
	component: BranchDetailPage,
})

function BranchDetailPage() {
	const { id } = Route.useParams()
	const { session } = Route.useRouteContext()
	const queryClient = useQueryClient()

	const canDeactivate = hasPermission(session.user.role, "branch.deactivate")
	const isAdmin = session.user.role === "ADMIN"

	const [name, setName] = useState("")
	const [city, setCity] = useState("")
	const [area, setArea] = useState("")
	const [address, setAddress] = useState("")
	const [phone, setPhone] = useState("")
	const [formError, setFormError] = useState<string | null>(null)
	const [confirmOpen, setConfirmOpen] = useState(false)

	const branchQuery = useQuery({
		queryKey: ["branches", id],
		queryFn: () => api.branches.get(id),
	})

	const branch = branchQuery.data?.branch

	useEffect(() => {
		if (!branch) return
		setName(branch.name)
		setCity(branch.city)
		setArea(branch.area ?? "")
		setAddress(branch.address ?? "")
		setPhone(branch.phone ?? "")
	}, [branch])

	const updateMutation = useMutation({
		mutationFn: () => {
			if (!branch) throw new Error("Branch not loaded")
			const input: Record<string, string> = {}
			if (name !== branch.name) input.name = name
			if (isAdmin && city !== branch.city) input.city = city
			if (isAdmin && area !== (branch.area ?? "")) input.area = area
			if (address !== (branch.address ?? "")) input.address = address
			if (phone !== (branch.phone ?? "")) input.phone = phone
			return api.branches.update(branch.id, input)
		},
		onSuccess: async () => {
			toast.success("Branch updated")
			await queryClient.invalidateQueries({ queryKey: ["branches"] })
		},
		onError: (error) => {
			setFormError(null)
			toastApiError(error)
		},
	})

	const deactivateMutation = useMutation({
		mutationFn: () => api.branches.deactivate(id),
		onSuccess: async () => {
			toast.success("Branch deactivated")
			setConfirmOpen(false)
			await queryClient.invalidateQueries({ queryKey: ["branches"] })
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

	if (branchQuery.isLoading) {
		return <p className="text-sm text-muted-foreground">Loading branch…</p>
	}
	if (branchQuery.isError || !branch) {
		return (
			<div className="text-sm text-muted-foreground">
				<p>Branch not found or not visible to you.</p>
				<Button variant="outline" size="sm" className="mt-3" asChild>
					<Link to="/branches">Back to branches</Link>
				</Button>
			</div>
		)
	}

	return (
		<div className="max-w-xl">
			<Button variant="ghost" size="sm" className="mb-3 -ml-2" asChild>
				<Link to="/branches">
					<ArrowLeftIcon className="size-4" />
					Branches
				</Link>
			</Button>

			<PageHeader
				title={branch.name}
				description={`${branch.code} · ${branch.type === "WAREHOUSE" ? "Warehouse" : "Retail"}`}
				actions={<ActiveBadge active={branch.isActive} />}
			/>

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

			<p className="mt-3 text-xs text-muted-foreground">
				Created {new Date(branch.createdAt).toLocaleString()} · Updated{" "}
				{new Date(branch.updatedAt).toLocaleString()}
			</p>

			<ConfirmDialog
				open={confirmOpen}
				onOpenChange={setConfirmOpen}
				title={`Deactivate ${branch.code}?`}
				description="The branch stays visible in reports and history, but new terminals cannot be added and staff cannot be assigned to it. This can be reversed by an administrator in the database."
				confirmLabel="Deactivate"
				destructive
				pending={deactivateMutation.isPending}
				onConfirm={() => deactivateMutation.mutate()}
			/>
		</div>
	)
}
