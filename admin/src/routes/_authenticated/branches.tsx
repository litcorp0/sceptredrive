import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { PlusIcon } from "lucide-react"
import { type FormEvent, useEffect, useState } from "react"
import { toast } from "sonner"
import { PageHeader } from "#/components/common/page-header"
import { ActiveBadge, StatusBadge } from "#/components/common/status-badge"
import { TableMessage } from "#/components/common/table-message"
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
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table"
import { ApiError, api } from "#/lib/api"
import type { BranchType } from "#/lib/api-types"
import { useDebouncedValue } from "#/lib/hooks"
import { hasPermission } from "#/lib/role"
import { toastApiError } from "#/lib/toast"

export const Route = createFileRoute("/_authenticated/branches")({
	component: BranchesPage,
})

function BranchesPage() {
	const { session } = Route.useRouteContext()
	const canCreate = hasPermission(session.user.role, "branch.create")

	const [createOpen, setCreateOpen] = useState(false)

	const branchesQuery = useQuery({
		queryKey: ["branches", { includeInactive: true }],
		queryFn: () => api.branches.list({ includeInactive: true }),
	})

	const branches = branchesQuery.data?.branches ?? []

	return (
		<div>
			<PageHeader
				title="Branches"
				description="Retail stores and warehouses. Codes identify branches everywhere."
				actions={
					canCreate ? (
						<Button size="sm" onClick={() => setCreateOpen(true)}>
							<PlusIcon className="size-4" />
							New branch
						</Button>
					) : undefined
				}
			/>

			<div className="rounded-lg border bg-card">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="w-28">Code</TableHead>
							<TableHead>Name</TableHead>
							<TableHead className="w-32">Type</TableHead>
							<TableHead>City / Area</TableHead>
							<TableHead className="w-24">Status</TableHead>
							<TableHead className="w-16" />
						</TableRow>
					</TableHeader>
					<TableBody>
						{branchesQuery.isLoading ? (
							<TableMessage colSpan={6}>Loading branches…</TableMessage>
						) : branchesQuery.isError ? (
							<TableMessage colSpan={6} tone="error">
								Couldn't load branches.
							</TableMessage>
						) : branches.length === 0 ? (
							<TableMessage colSpan={6}>
								No branches yet. Create the first one to get started.
							</TableMessage>
						) : (
							branches.map((branch) => (
								<TableRow key={branch.id}>
									<TableCell className="font-mono text-xs">{branch.code}</TableCell>
									<TableCell className="font-medium">{branch.name}</TableCell>
									<TableCell>
										<StatusBadge tone={branch.type === "WAREHOUSE" ? "amber" : "zinc"}>
											{branch.type === "WAREHOUSE" ? "Warehouse" : "Retail"}
										</StatusBadge>
									</TableCell>
									<TableCell className="text-muted-foreground">
										{[branch.city, branch.area].filter(Boolean).join(" · ")}
									</TableCell>
									<TableCell>
										<ActiveBadge active={branch.isActive} />
									</TableCell>
									<TableCell>
										<Button variant="ghost" size="sm" asChild>
											<Link to="/branches/$id" params={{ id: branch.id }}>
												View
											</Link>
										</Button>
									</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</div>

			{canCreate ? <CreateBranchDialog open={createOpen} onOpenChange={setCreateOpen} /> : null}
		</div>
	)
}

function CreateBranchDialog({
	open,
	onOpenChange,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
}) {
	const queryClient = useQueryClient()

	const [name, setName] = useState("")
	const [type, setType] = useState<BranchType>("RETAIL")
	const [city, setCity] = useState("")
	const [area, setArea] = useState("")
	const [address, setAddress] = useState("")
	const [phone, setPhone] = useState("")
	const [code, setCode] = useState("")
	const [codeTouched, setCodeTouched] = useState(false)
	const [formError, setFormError] = useState<string | null>(null)

	const debouncedCity = useDebouncedValue(city, 400)
	const debouncedArea = useDebouncedValue(area, 400)

	useEffect(() => {
		if (codeTouched || debouncedCity.trim().length === 0) return
		let cancelled = false
		void api.branches
			.suggestCode({ city: debouncedCity, area: debouncedArea || undefined, type })
			.then((suggestion) => {
				if (!cancelled) setCode(suggestion.code)
			})
			.catch(() => undefined)
		return () => {
			cancelled = true
		}
	}, [debouncedCity, debouncedArea, type, codeTouched])

	const createMutation = useMutation({
		mutationFn: () =>
			api.branches.create({
				code,
				name,
				type,
				city,
				area: area || undefined,
				address: address || undefined,
				phone: phone || undefined,
			}),
		onSuccess: async (data) => {
			toast.success(`Branch ${data.branch.code} created`)
			await queryClient.invalidateQueries({ queryKey: ["branches"] })
			onOpenChange(false)
			resetForm()
		},
		onError: (error) => {
			if (error instanceof ApiError && error.status === 409) {
				setFormError(error.message)
				return
			}
			toastApiError(error)
		},
	})

	function resetForm() {
		setName("")
		setType("RETAIL")
		setCity("")
		setArea("")
		setAddress("")
		setPhone("")
		setCode("")
		setCodeTouched(false)
		setFormError(null)
	}

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		setFormError(null)
		createMutation.mutate()
	}

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				onOpenChange(next)
				if (!next) resetForm()
			}}
		>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>New branch</DialogTitle>
					<DialogDescription>
						The code is suggested from the city and area; adjust it before saving.
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="grid gap-4">
					<div className="grid gap-1.5">
						<Label htmlFor="branch-name">Name</Label>
						<Input
							id="branch-name"
							required
							minLength={2}
							value={name}
							onChange={(event) => setName(event.target.value)}
						/>
					</div>

					<div className="grid grid-cols-2 gap-3">
						<div className="grid gap-1.5">
							<Label htmlFor="branch-type">Type</Label>
							<Select value={type} onValueChange={(value) => setType(value as BranchType)}>
								<SelectTrigger id="branch-type" className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="RETAIL">Retail</SelectItem>
									<SelectItem value="WAREHOUSE">Warehouse</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div className="grid gap-1.5">
							<Label htmlFor="branch-code">Code</Label>
							<Input
								id="branch-code"
								required
								className="font-mono"
								placeholder="ACC-SPX"
								value={code}
								onChange={(event) => {
									setCode(event.target.value.toUpperCase())
									setCodeTouched(true)
								}}
							/>
						</div>
					</div>

					<div className="grid grid-cols-2 gap-3">
						<div className="grid gap-1.5">
							<Label htmlFor="branch-city">City</Label>
							<Input
								id="branch-city"
								required
								value={city}
								onChange={(event) => setCity(event.target.value)}
							/>
						</div>
						<div className="grid gap-1.5">
							<Label htmlFor="branch-area">Area</Label>
							<Input
								id="branch-area"
								value={area}
								onChange={(event) => setArea(event.target.value)}
							/>
						</div>
					</div>

					<div className="grid gap-1.5">
						<Label htmlFor="branch-address">Address</Label>
						<Input
							id="branch-address"
							value={address}
							onChange={(event) => setAddress(event.target.value)}
						/>
					</div>

					<div className="grid gap-1.5">
						<Label htmlFor="branch-phone">Phone</Label>
						<Input
							id="branch-phone"
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
							{createMutation.isPending ? "Creating…" : "Create branch"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
