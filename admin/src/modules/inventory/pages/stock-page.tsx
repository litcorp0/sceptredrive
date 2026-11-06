import { useQuery } from "@tanstack/react-query"
import { getRouteApi, Link } from "@tanstack/react-router"
import { SearchIcon } from "lucide-react"
import { useState } from "react"
import { Pagination } from "#/components/common/pagination"
import { StatusBadge } from "#/components/common/status-badge"
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
import { useBranch } from "#/lib/branch-context"
import { formatGhs } from "#/lib/format"
import { useDebouncedValue } from "#/lib/hooks"
import { hasPermission } from "#/lib/role"
import { stockListOptions } from "../api/inventory"
import { AdjustDialog } from "../components/adjust-dialog"
import { ReceiveDialog } from "../components/receive-dialog"
import { StockReport } from "../components/stock-report"

const authenticatedRoute = getRouteApi("/_authenticated")
const listRoute = getRouteApi("/_authenticated/inventory/stock/")

const PAGE_SIZE = 25

export function StockPage() {
	const { session } = authenticatedRoute.useRouteContext()
	const { activeBranchId, activeBranch } = useBranch()
	const canReceive = hasPermission(session.user.role, "inventory.receive")
	const canAdjust = hasPermission(session.user.role, "inventory.adjust")
	const listSearch = listRoute.useSearch()
	const navigateSearch = listRoute.useNavigate()

	const [search, setSearch] = useState("")
	const lowOnly = listSearch.lowStock === "true"
	const reportMode = listSearch.report === "true"
	// On unless the URL says otherwise: a stock list is a branch's own shelf, not the
	// whole catalogue (P20-D17).
	const carriedOnly = listSearch.carried !== "false"
	const [offset, setOffset] = useState(0)
	const [receiveOpen, setReceiveOpen] = useState(false)
	const [adjustOpen, setAdjustOpen] = useState(false)

	const debouncedSearch = useDebouncedValue(search, 300)

	const branchId = listSearch.branchId ?? activeBranchId
	const filters = {
		branchId: branchId ?? undefined,
		q: debouncedSearch.trim() || undefined,
		lowStock: lowOnly ? true : undefined,
		carried: carriedOnly ? true : undefined,
		limit: PAGE_SIZE,
		offset,
	}

	const stockQuery = useQuery({
		...stockListOptions(filters),
		enabled: !reportMode && branchId !== null,
	})

	const rows = stockQuery.data?.stock ?? []
	const total = stockQuery.data?.total ?? 0

	return (
		<section>
			<div className="mb-3 flex flex-wrap items-end gap-3 print:hidden">
				{reportMode ? null : (
					<>
						<div className="relative min-w-56 flex-1">
							<SearchIcon
								className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
								aria-hidden="true"
							/>
							<Input
								className="pl-8"
								placeholder="Search by name or SKU…"
								value={search}
								onChange={(event) => {
									setSearch(event.target.value)
									setOffset(0)
								}}
								aria-label="Search stock"
							/>
						</div>

						<div className="flex items-center gap-2 pb-2">
							<Switch
								id="low-stock-only"
								checked={lowOnly}
								onCheckedChange={(checked) => {
									void navigateSearch({
										search: (prev) => ({ ...prev, lowStock: checked ? "true" : undefined }),
									})
									setOffset(0)
								}}
							/>
							<Label htmlFor="low-stock-only">Low stock only</Label>
						</div>

						<div className="flex items-center gap-2 pb-2">
							<Switch
								id="stock-carried-only"
								checked={carriedOnly}
								onCheckedChange={(checked) => {
									void navigateSearch({
										search: (prev) => ({ ...prev, carried: checked ? undefined : "false" }),
									})
									setOffset(0)
								}}
							/>
							<Label htmlFor="stock-carried-only">Stocked here only</Label>
						</div>
					</>
				)}

				<div className="flex items-center gap-2 pb-2">
					<Switch
						id="stock-report-mode"
						checked={reportMode}
						onCheckedChange={(checked) => {
							void navigateSearch({
								search: (prev) => ({ ...prev, report: checked ? "true" : undefined }),
							})
							setOffset(0)
						}}
					/>
					<Label htmlFor="stock-report-mode">Report mode</Label>
				</div>

				{reportMode ? null : (
					<div className="ml-auto flex gap-2 pb-1">
						{canReceive ? (
							<Button size="sm" disabled={!activeBranchId} onClick={() => setReceiveOpen(true)}>
								Receive stock
							</Button>
						) : null}
						{canAdjust ? (
							<Button
								size="sm"
								variant="outline"
								disabled={!activeBranchId}
								onClick={() => setAdjustOpen(true)}
							>
								Adjust
							</Button>
						) : null}
					</div>
				)}
			</div>

			{reportMode ? (
				<StockReport />
			) : activeBranchId === null ? (
				<div className="rounded-md border p-8 text-center text-sm text-muted-foreground">
					Choose a branch from the header to view its stock.
				</div>
			) : (
				<>
					<div className="rounded-md border">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>SKU</TableHead>
									<TableHead>Product</TableHead>
									{branchId === null ? <TableHead>Branch</TableHead> : null}
									<TableHead>Category</TableHead>
									<TableHead className="text-right">On hand</TableHead>
									<TableHead className="text-right">Avg cost</TableHead>
									<TableHead className="text-right">Value</TableHead>
									<TableHead className="text-right">Threshold</TableHead>
									<TableHead>Status</TableHead>
									<TableHead className="w-16" />
								</TableRow>
							</TableHeader>
							<TableBody>
								{stockQuery.isLoading ? (
									<TableRow>
										<TableCell
											colSpan={branchId === null ? 10 : 9}
											className="text-muted-foreground"
										>
											Loading stock…
										</TableCell>
									</TableRow>
								) : stockQuery.isError ? (
									<TableRow>
										<TableCell colSpan={branchId === null ? 10 : 9} className="text-destructive">
											Could not load stock.
										</TableCell>
									</TableRow>
								) : rows.length === 0 ? (
									<TableRow>
										<TableCell
											colSpan={branchId === null ? 10 : 9}
											className="text-muted-foreground"
										>
											{lowOnly
												? "No products are at or below their threshold."
												: "No stock recorded for this branch yet. Receive stock to begin."}
										</TableCell>
									</TableRow>
								) : (
									rows.map((row) => (
										<TableRow key={row.productId}>
											<TableCell className="font-mono text-xs">{row.sku}</TableCell>
											<TableCell className="font-medium">{row.productName}</TableCell>
											{branchId === null ? (
												<TableCell className="text-muted-foreground">{row.branchName}</TableCell>
											) : null}
											<TableCell className="text-muted-foreground">{row.categoryName}</TableCell>
											<TableCell className="text-right tabular-nums">
												{/* A branch that never carried the product has no level, which is not
												    the same fact as a product it carries and has run out of. */}
												{row.neverStocked ? "—" : row.quantityOnHand}
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{formatGhs(row.avgCostMinor)}
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{formatGhs(row.valueMinor)}
											</TableCell>
											<TableCell className="text-right tabular-nums">{row.threshold}</TableCell>
											<TableCell>
												{/* Disjoint buckets: empty is out of stock, not "OK" (18-02/D3).
												    A product this branch never carried is neither: it has no level
												    here at all, so it reads as "not stocked" rather than as a
												    shortage a manager should chase. */}
												{row.neverStocked ? (
													<StatusBadge variant="muted">Not stocked here</StatusBadge>
												) : row.quantityOnHand <= 0 ? (
													<StatusBadge tone="red">Out of stock</StatusBadge>
												) : row.isLow ? (
													<StatusBadge tone="amber">Low</StatusBadge>
												) : (
													<StatusBadge tone="green">OK</StatusBadge>
												)}
											</TableCell>
											<TableCell>
												<Link
													to="/inventory/stock/$productId"
													params={{ productId: row.productId }}
													className="text-sm font-medium text-primary hover:underline"
												>
													View
												</Link>
											</TableCell>
										</TableRow>
									))
								)}
							</TableBody>
						</Table>
					</div>

					{stockQuery.isSuccess ? (
						<Pagination
							total={total}
							limit={PAGE_SIZE}
							offset={offset}
							onOffsetChange={setOffset}
						/>
					) : null}
				</>
			)}

			<ReceiveDialog
				open={receiveOpen}
				onOpenChange={setReceiveOpen}
				branchId={activeBranchId}
				branchName={activeBranch?.name ?? null}
				canPickSupplier={hasPermission(session.user.role, "supplier.read")}
			/>
			<AdjustDialog
				open={adjustOpen}
				onOpenChange={setAdjustOpen}
				branchId={activeBranchId}
				branchName={activeBranch?.name ?? null}
			/>
		</section>
	)
}
