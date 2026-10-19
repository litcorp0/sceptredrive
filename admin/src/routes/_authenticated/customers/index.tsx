import { formatGhanaPhone } from "@gikautos/shared"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { PlusIcon, SearchIcon } from "lucide-react"
import { useState } from "react"
import { Pagination } from "#/components/common/pagination"
import { ActiveBadge, StatusBadge } from "#/components/common/status-badge"
import { TableMessage } from "#/components/common/table-message"
import { CustomerFormDialog } from "#/components/customers/customer-form-dialog"
import { Button } from "#/components/ui/button"
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"
import { Switch } from "#/components/ui/switch"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table"
import { api } from "#/lib/api"
import type { CustomerListRow } from "#/lib/api-types"
import { useDebouncedValue } from "#/lib/hooks"
import { hasPermission } from "#/lib/role"

export const Route = createFileRoute("/_authenticated/customers/")({
	component: CustomersTab,
})

const PAGE_SIZE = 20

function CustomersTab() {
	const { session } = Route.useRouteContext()
	const canCreate = hasPermission(session.user.role, "customer.create")
	const canViewArchived = hasPermission(session.user.role, "customer.archive")

	const [search, setSearch] = useState("")
	const [includeArchived, setIncludeArchived] = useState(false)
	const [offset, setOffset] = useState(0)
	const [dialogOpen, setDialogOpen] = useState(false)

	const debouncedSearch = useDebouncedValue(search, 300)
	const trimmedSearch = debouncedSearch.trim()

	const filters = {
		// The API requires at least two characters before it will search.
		q: trimmedSearch.length >= 2 ? trimmedSearch : undefined,
		includeArchived: canViewArchived && includeArchived ? true : undefined,
		page: Math.floor(offset / PAGE_SIZE) + 1,
		pageSize: PAGE_SIZE,
	}

	const customersQuery = useQuery({
		queryKey: ["customers", filters],
		queryFn: () => api.customers.list(filters),
	})

	const customers = customersQuery.data?.customers ?? []
	const total = customersQuery.data?.total ?? 0

	return (
		<section>
			<div className="mb-3 flex flex-wrap items-end gap-3">
				<div className="relative min-w-56 flex-1">
					<SearchIcon
						className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
						aria-hidden="true"
					/>
					<Input
						className="pl-8"
						placeholder="Search by phone or name…"
						value={search}
						onChange={(event) => {
							setSearch(event.target.value)
							setOffset(0)
						}}
						aria-label="Search customers by phone or name"
					/>
				</div>

				{canViewArchived ? (
					<div className="flex items-center gap-2 pb-2">
						<Switch
							id="show-archived-customers"
							checked={includeArchived}
							onCheckedChange={(checked) => {
								setIncludeArchived(checked)
								setOffset(0)
							}}
						/>
						<Label htmlFor="show-archived-customers" className="text-sm text-muted-foreground">
							Show archived
						</Label>
					</div>
				) : null}

				{canCreate ? (
					<Button size="sm" className="ml-auto" onClick={() => setDialogOpen(true)}>
						<PlusIcon className="size-4" aria-hidden="true" />
						New customer
					</Button>
				) : null}
			</div>

			<div className="rounded-lg border bg-card">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Name</TableHead>
							<TableHead className="w-40">Phone</TableHead>
							<TableHead className="w-56">Email</TableHead>
							<TableHead className="w-36">Created</TableHead>
							<TableHead className="w-28">Status</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{customersQuery.isLoading ? (
							<TableMessage colSpan={5}>Loading customers…</TableMessage>
						) : customersQuery.isError ? (
							<TableMessage colSpan={5} tone="error">
								Couldn't load customers.
							</TableMessage>
						) : customers.length === 0 ? (
							<TableMessage colSpan={5}>
								{trimmedSearch.length >= 2
									? "No customers match this search."
									: "No customers yet. Create the first one."}
							</TableMessage>
						) : (
							customers.map((customer) => (
								<TableRow key={customer.id}>
									<TableCell>
										<Link
											to="/customers/$id"
											params={{ id: customer.id }}
											className="font-medium hover:underline"
										>
											{customer.name}
										</Link>
									</TableCell>
									<TableCell className="tabular-nums text-muted-foreground">
										{customer.phone ? formatGhanaPhone(customer.phone) : "—"}
									</TableCell>
									<TableCell className="text-muted-foreground">{customer.email ?? "—"}</TableCell>
									<TableCell className="text-muted-foreground">
										{new Date(customer.createdAt).toLocaleDateString("en-GH")}
									</TableCell>
									<TableCell>{customerStatus(customer)}</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</div>

			<Pagination total={total} limit={PAGE_SIZE} offset={offset} onOffsetChange={setOffset} />

			<CustomerFormDialog open={dialogOpen} onOpenChange={setDialogOpen} />
		</section>
	)
}

function customerStatus(customer: CustomerListRow) {
	if (customer.anonymizedAt) return <StatusBadge tone="zinc">Anonymized</StatusBadge>
	if (customer.status === "ARCHIVED") return <StatusBadge tone="zinc">Archived</StatusBadge>
	return <ActiveBadge active />
}
