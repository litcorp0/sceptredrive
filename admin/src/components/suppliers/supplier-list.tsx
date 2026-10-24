import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { PlusIcon, SearchIcon } from "lucide-react"
import { useState } from "react"
import { Pagination } from "#/components/common/pagination"
import { ActiveBadge, StatusBadge } from "#/components/common/status-badge"
import { TableMessage } from "#/components/common/table-message"
import { SupplierFormDialog } from "#/components/suppliers/supplier-form-dialog"
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
// TODO(phase-8/11): the Owed column is payables' balance read, not supplier master data. It moves
// to the payables module with Plan 11; until then it keeps the legacy `api.payables` group.
import type { SupplierBalance } from "#/lib/api-types"
import { formatGhs } from "#/lib/format"
import { useDebouncedValue } from "#/lib/hooks"
import { hasPermission } from "#/lib/role"
import { type SupplierListRow, supplierListOptions } from "#/modules/suppliers"

const PAGE_SIZE = 20

export function SupplierList({ role }: { role: string }) {
	const canCreate = hasPermission(role, "supplier.create")
	const canViewArchived = hasPermission(role, "supplier.archive")
	const canViewOwed = hasPermission(role, "payable.read")

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

	const suppliersQuery = useQuery(supplierListOptions(filters))

	// Owed column: one aggregated row per supplier, branch-scoped by the API.
	const balancesQuery = useQuery({
		queryKey: ["supplier-balances"],
		queryFn: () => api.payables.balances.list(),
		enabled: canViewOwed,
	})
	const owedBySupplier = new Map(
		(balancesQuery.data?.balances ?? []).map((balance) => [balance.supplierId, balance]),
	)

	const suppliers = suppliersQuery.data?.suppliers ?? []
	const total = suppliersQuery.data?.total ?? 0
	const columnCount = canViewOwed ? 7 : 6

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
						placeholder="Search by name or code…"
						value={search}
						onChange={(event) => {
							setSearch(event.target.value)
							setOffset(0)
						}}
						aria-label="Search suppliers by name or code"
					/>
				</div>

				{canViewArchived ? (
					<div className="flex items-center gap-2 pb-2">
						<Switch
							id="show-archived-suppliers"
							checked={includeArchived}
							onCheckedChange={(checked) => {
								setIncludeArchived(checked)
								setOffset(0)
							}}
						/>
						<Label htmlFor="show-archived-suppliers" className="text-sm text-muted-foreground">
							Show archived
						</Label>
					</div>
				) : null}

				{canCreate ? (
					<Button size="sm" className="ml-auto" onClick={() => setDialogOpen(true)}>
						<PlusIcon className="size-4" aria-hidden="true" />
						New supplier
					</Button>
				) : null}
			</div>

			<div className="rounded-lg border bg-card">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="w-32">Code</TableHead>
							<TableHead>Name</TableHead>
							<TableHead className="w-44">Contact</TableHead>
							<TableHead className="w-40">Phone</TableHead>
							<TableHead className="w-24">Terms</TableHead>
							{canViewOwed ? <TableHead className="w-32 text-right">Owed</TableHead> : null}
							<TableHead className="w-28">Status</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{suppliersQuery.isLoading ? (
							<TableMessage colSpan={columnCount}>Loading suppliers…</TableMessage>
						) : suppliersQuery.isError ? (
							<TableMessage colSpan={columnCount} tone="error">
								Couldn't load suppliers.
							</TableMessage>
						) : suppliers.length === 0 ? (
							<TableMessage colSpan={columnCount}>
								{trimmedSearch.length >= 2
									? "No suppliers match this search."
									: "No suppliers yet. Create the first one."}
							</TableMessage>
						) : (
							suppliers.map((supplier) => (
								<TableRow
									key={supplier.id}
									className={supplier.status === "ARCHIVED" ? "opacity-60" : undefined}
								>
									<TableCell className="font-mono text-xs text-muted-foreground">
										{supplier.code}
									</TableCell>
									<TableCell>
										<Link
											to="/suppliers/$supplierId"
											params={{ supplierId: supplier.id }}
											className="font-medium hover:underline"
										>
											{supplier.name}
										</Link>
									</TableCell>
									<TableCell className="text-muted-foreground">
										{supplier.contactName ?? "—"}
									</TableCell>
									<TableCell className="tabular-nums text-muted-foreground">
										{supplier.phone ?? "—"}
									</TableCell>
									<TableCell className="tabular-nums text-muted-foreground">
										{supplier.paymentTermDays} days
									</TableCell>
									{canViewOwed ? <OwedCell balance={owedBySupplier.get(supplier.id)} /> : null}
									<TableCell>{supplierStatus(supplier)}</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</div>

			<Pagination total={total} limit={PAGE_SIZE} offset={offset} onOffsetChange={setOffset} />

			<SupplierFormDialog open={dialogOpen} onOpenChange={setDialogOpen} />
		</section>
	)
}

function supplierStatus(supplier: SupplierListRow) {
	if (supplier.status === "ARCHIVED") return <StatusBadge tone="zinc">Archived</StatusBadge>
	return <ActiveBadge active />
}

function OwedCell({ balance }: { balance: SupplierBalance | undefined }) {
	if (!balance) {
		return <TableCell className="text-right text-muted-foreground">—</TableCell>
	}
	return (
		<TableCell className="text-right tabular-nums">
			{formatGhs(balance.owedMinor)}
			{balance.overdueMinor > 0 ? (
				<p className="text-xs text-destructive">{formatGhs(balance.overdueMinor)} overdue</p>
			) : null}
		</TableCell>
	)
}
