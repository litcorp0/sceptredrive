import { useQuery } from "@tanstack/react-query"
import { getRouteApi, Link } from "@tanstack/react-router"
import { PlusIcon, SearchIcon } from "lucide-react"
import { useState } from "react"
import { type PickedSupplier, SupplierCombobox } from "#/components/common/supplier-combobox"
import { Button } from "#/components/ui/button"
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
import { useDebouncedValue } from "#/lib/hooks"
import { hasPermission } from "#/lib/role"
import { orderListOptions } from "../api/orders"
import { OrderList } from "../components/order-list"
import type { OrderStatus } from "../types"
import { statusLabel } from "../utils/order"

const authenticatedRoute = getRouteApi("/_authenticated")

const PAGE_SIZE = 20

const STATUS_OPTIONS: OrderStatus[] = [
	"DRAFT",
	"PENDING_APPROVAL",
	"APPROVED",
	"SENT",
	"PARTIALLY_RECEIVED",
	"RECEIVED",
	"CLOSED",
	"CANCELLED",
	"REJECTED",
]

/**
 * The procurement order list.
 *
 * The branch comes from the shell (`useBranch`), the supplier filter is the shared combobox, and
 * the API scopes every row: a manager never sees another branch's numbers because it refuses
 * them, not because this screen filters afterwards.
 */
export function OrdersPage() {
	const { session } = authenticatedRoute.useRouteContext()
	const { activeBranchId, canSelectBranch } = useBranch()
	const canCreate = hasPermission(session.user.role, "procurement.create")

	const [status, setStatus] = useState<"ALL" | OrderStatus>("ALL")
	const [supplier, setSupplier] = useState<PickedSupplier | null>(null)
	const [search, setSearch] = useState("")
	const [offset, setOffset] = useState(0)

	const debouncedSearch = useDebouncedValue(search, 300)
	const query = debouncedSearch.trim()

	const filters = {
		branchId: activeBranchId ?? undefined,
		supplierId: supplier?.id,
		status: status === "ALL" ? undefined : status,
		q: query.length >= 2 ? query : undefined,
		limit: PAGE_SIZE,
		offset,
	}

	const ordersQuery = useQuery(orderListOptions(filters))

	const orders = ordersQuery.data?.orders ?? []
	const total = ordersQuery.data?.total ?? 0
	const filtered = status !== "ALL" || supplier !== null || query.length >= 2

	function resetOffset() {
		setOffset(0)
	}

	return (
		<section>
			<div className="mb-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
				<div className="grid gap-1.5">
					<Label>Supplier</Label>
					<SupplierCombobox
						value={supplier}
						onSelect={(next) => {
							setSupplier(next)
							resetOffset()
						}}
					/>
				</div>

				<div className="grid gap-1.5">
					<Label htmlFor="order-status-filter">Status</Label>
					<Select
						value={status}
						onValueChange={(value) => {
							setStatus(value as "ALL" | OrderStatus)
							resetOffset()
						}}
					>
						<SelectTrigger id="order-status-filter" className="w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="ALL">All statuses</SelectItem>
							{STATUS_OPTIONS.map((option) => (
								<SelectItem key={option} value={option}>
									{statusLabel(option)}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>

				<div className="grid gap-1.5">
					<Label htmlFor="order-search">Order number</Label>
					<div className="relative">
						<SearchIcon
							className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
							aria-hidden="true"
						/>
						<Input
							id="order-search"
							className="pl-8 font-mono"
							placeholder="PO-…"
							value={search}
							onChange={(event) => {
								setSearch(event.target.value)
								resetOffset()
							}}
						/>
					</div>
					<p className="text-xs text-muted-foreground">Two characters or more.</p>
				</div>

				{canCreate ? (
					<div className="flex items-end">
						<Button size="sm" className="w-full" asChild>
							<Link to="/procurement/orders/new">
								<PlusIcon className="size-4" aria-hidden="true" />
								New order
							</Link>
						</Button>
					</div>
				) : null}
			</div>

			<OrderList
				orders={orders}
				isLoading={ordersQuery.isLoading}
				isError={ordersQuery.isError}
				canSelectBranch={canSelectBranch}
				total={total}
				limit={PAGE_SIZE}
				offset={offset}
				onOffsetChange={setOffset}
				emptyMessage={
					filtered
						? "No purchase orders match these filters."
						: "No purchase orders yet. Create the first one."
				}
			/>
		</section>
	)
}
