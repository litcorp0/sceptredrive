import { formatDateTime } from "@sceptre/shared"
import { useQuery } from "@tanstack/react-query"
import { getRouteApi, Link } from "@tanstack/react-router"
import { ChevronLeftIcon } from "lucide-react"
import { useState } from "react"
import { PageHeader } from "#/components/common/page-header"
import { Pagination } from "#/components/common/pagination"
import { StatusBadge } from "#/components/common/status-badge"
import { Button } from "#/components/ui/button"
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
import { hasPermission } from "#/lib/role"
import { movementListOptions, stockDetailOptions } from "../api/inventory"
import { ThresholdDialog } from "../components/threshold-dialog"
import { MOVEMENT_META } from "../utils/stock"

const authenticatedRoute = getRouteApi("/_authenticated")
const stockRoute = getRouteApi("/_authenticated/inventory/stock/$productId")

const PAGE_SIZE = 25

function Stat({ label, value }: { label: string; value: string }) {
	return (
		<div className="rounded-md border p-3">
			<p className="text-xs text-muted-foreground">{label}</p>
			<p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
		</div>
	)
}

export function StockDetailPage() {
	const { productId } = stockRoute.useParams()
	const { session } = authenticatedRoute.useRouteContext()
	const { activeBranchId, activeBranch } = useBranch()
	const canThreshold = hasPermission(session.user.role, "inventory.threshold")

	const [offset, setOffset] = useState(0)
	const [thresholdOpen, setThresholdOpen] = useState(false)

	const detailQuery = useQuery({
		...stockDetailOptions(productId, activeBranchId),
		enabled: activeBranchId !== null,
	})

	const movementsQuery = useQuery({
		...movementListOptions(productId, activeBranchId, offset, PAGE_SIZE),
		enabled: activeBranchId !== null,
	})

	const stock = detailQuery.data?.stock
	const movements = movementsQuery.data?.movements ?? []
	const total = movementsQuery.data?.total ?? 0

	if (activeBranchId === null) {
		return (
			<div className="rounded-md border p-8 text-center text-sm text-muted-foreground">
				Choose a branch from the header to view this product's stock.
			</div>
		)
	}

	return (
		<section>
			<PageHeader
				title={stock?.productName ?? "Product stock"}
				description={stock ? `${stock.sku} · ${stock.categoryName}` : "Loading product stock…"}
				actions={
					<div className="flex gap-2">
						<Button asChild variant="outline" size="sm">
							<Link to="/inventory/stock">
								<ChevronLeftIcon className="size-4" aria-hidden="true" />
								Back to stock
							</Link>
						</Button>
						{canThreshold ? (
							<Button
								size="sm"
								variant="outline"
								disabled={!stock}
								onClick={() => setThresholdOpen(true)}
							>
								{stock?.threshold === null || stock?.threshold === undefined
									? "Set threshold"
									: "Edit threshold"}
							</Button>
						) : null}
					</div>
				}
			/>

			<p className="mb-4 text-sm text-muted-foreground">Branch: {activeBranch?.name ?? "—"}</p>

			{detailQuery.isLoading ? (
				<p className="text-sm text-muted-foreground">Loading stock…</p>
			) : detailQuery.isError || !stock ? (
				<p className="text-sm text-destructive">Could not load this product's stock.</p>
			) : (
				<>
					<div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
						<Stat label="On hand" value={String(stock.quantityOnHand)} />
						<Stat label="Average cost" value={formatGhs(stock.avgCostMinor)} />
						<Stat label="Stock value" value={formatGhs(stock.valueMinor)} />
						<div className="rounded-md border p-3">
							<p className="text-xs text-muted-foreground">Low-stock threshold</p>
							<p className="mt-1 text-lg font-semibold tabular-nums">{stock.threshold ?? "—"}</p>
							<div className="mt-1">
								{stock.threshold !== null && stock.quantityOnHand <= stock.threshold ? (
									<StatusBadge tone="amber">Low</StatusBadge>
								) : (
									<StatusBadge tone="green">OK</StatusBadge>
								)}
							</div>
						</div>
					</div>

					<h2 className="mb-2 text-sm font-semibold">Movement history</h2>
					<div className="rounded-md border">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Date</TableHead>
									<TableHead>Type</TableHead>
									<TableHead>Reference</TableHead>
									<TableHead>Reason</TableHead>
									<TableHead className="text-right">Qty</TableHead>
									<TableHead className="text-right">Unit cost</TableHead>
									<TableHead>Actor</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{movementsQuery.isLoading ? (
									<TableRow>
										<TableCell colSpan={7} className="text-muted-foreground">
											Loading movements…
										</TableCell>
									</TableRow>
								) : movements.length === 0 ? (
									<TableRow>
										<TableCell colSpan={7} className="text-muted-foreground">
											No movements at this branch yet.
										</TableCell>
									</TableRow>
								) : (
									movements.map((movement) => {
										const meta = MOVEMENT_META[movement.type]
										return (
											<TableRow key={movement.id}>
												<TableCell className="whitespace-nowrap text-muted-foreground">
													{formatDateTime(movement.createdAt)}
												</TableCell>
												<TableCell>
													<StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
												</TableCell>
												<TableCell className="font-mono text-xs">
													{movement.referenceNumber ?? "—"}
												</TableCell>
												<TableCell className="text-muted-foreground">
													{movement.reasonCode ?? movement.note ?? "—"}
												</TableCell>
												<TableCell
													className={
														movement.quantityDelta < 0
															? "text-right tabular-nums text-red-600"
															: "text-right tabular-nums text-emerald-700"
													}
												>
													{movement.quantityDelta > 0 ? "+" : ""}
													{movement.quantityDelta}
												</TableCell>
												<TableCell className="text-right tabular-nums">
													{formatGhs(movement.unitCostMinor)}
												</TableCell>
												<TableCell className="text-muted-foreground">
													{movement.createdBy ?? "—"}
												</TableCell>
											</TableRow>
										)
									})
								)}
							</TableBody>
						</Table>
					</div>

					{movementsQuery.isSuccess ? (
						<Pagination
							total={total}
							limit={PAGE_SIZE}
							offset={offset}
							onOffsetChange={setOffset}
						/>
					) : null}

					<ThresholdDialog
						open={thresholdOpen}
						onOpenChange={setThresholdOpen}
						branchId={activeBranchId}
						productId={productId}
						productName={stock.productName}
						currentThreshold={stock.threshold}
					/>
				</>
			)}
		</section>
	)
}
