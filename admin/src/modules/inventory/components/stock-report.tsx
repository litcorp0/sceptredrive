import { accraIsoDay, formatCount, formatDateTime, formatRange } from "@sceptre/shared"
import { useQuery } from "@tanstack/react-query"
import { getRouteApi } from "@tanstack/react-router"
import { ExportButton } from "#/components/common/export-button"
import { PrintButton } from "#/components/common/print-button"
import { PrintSheet, type PrintSheetMeta } from "#/components/common/print-sheet"
import { StatusBadge } from "#/components/common/status-badge"
import { StatusNote } from "#/components/common/status-note"
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select"
import { Switch } from "#/components/ui/switch"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table"
import { ApiError } from "#/lib/api"
import { useBranch } from "#/lib/branch-context"
import { formatGhs } from "#/lib/format"
import { categoryListOptions } from "#/modules/catalog"
import { STOCK_REPORT_EXPORT_PATH, stockReportOptions } from "../api/inventory"
import type { StockReportQuery } from "../types"
import { MOVEMENT_META } from "../utils/stock"

const listRoute = getRouteApi("/_authenticated/inventory/stock/")

/**
 * The stock report (RPT-04, P14-D16/D17).
 *
 * Four rules this screen is built on:
 * - **Totals come from the API.** `totals` is the projection's own sum; adding the rendered
 *   rows in the browser would produce a number that can disagree with the ledger.
 * - **The report mode is a URL flag**, not a second route, so a report can be linked, reloaded
 *   and printed by the next person.
 * - **Value is as at read.** `asOf` is printed because the projection has no history; the
 *   period filters the movement, transfer and count sections only.
 * - **A capped report says so, and refuses to export.** When the API reports `truncated`, the
 *   screen keeps showing the capped table and the whole-filter totals, but the API refuses
 *   the CSV with `REPORT_TOO_LARGE`: a file whose rows stop at the cap while its TOTAL covers
 *   every match is a file that does not add up. The banner states the refusal, and the export
 *   control is disabled and describes why.
 */
export function StockReport() {
	const search = listRoute.useSearch()
	const navigate = listRoute.useNavigate()
	const { branches, activeBranchId, canSelectBranch } = useBranch()
	const categoryQuery = useQuery(categoryListOptions({}))

	const today = accraIsoDay()
	const to = search.to ?? today
	const from = search.from ?? `${to.slice(0, 7)}-01`

	// `reportBranch=all` is explicit because an absent branch means "the shell's branch".
	const branchId =
		search.reportBranch === "all"
			? null
			: (search.reportBranch ?? (canSelectBranch ? activeBranchId : null))
	const query: StockReportQuery = {
		branchId: branchId ?? undefined,
		categoryId: search.categoryId,
		lowStock: search.lowStock === "true" ? true : undefined,
		from,
		to,
	}

	const reportQuery = useQuery(stockReportOptions(query))
	const report = reportQuery.data

	const categories = (categoryQuery.data?.categories ?? []).flatMap((node) => [
		node,
		...node.children,
	])
	const categoryName = categories.find((row) => row.id === search.categoryId)?.name
	const branchLabel = report?.branchId
		? (() => {
				const row = branches.find((entry) => entry.id === report.branchId)
				if (row) return `${row.name} (${row.code})`
				// The branch list can lag the report; the rows still know their branch code.
				return report.rows[0]?.branchCode ?? report.branchId
			})()
		: "All branches"

	const errorMessage =
		reportQuery.error instanceof ApiError
			? reportQuery.error.message
			: "Couldn't load the stock report."

	const setSearch = (patch: Record<string, string | undefined>) => {
		void navigate({ search: (prev) => ({ ...prev, ...patch }) })
	}

	const meta: PrintSheetMeta[] = [
		{ label: "Branch", value: branchLabel },
		{
			label: "Period",
			value: report ? formatRange(report.period.from, report.period.to) : formatRange(from, to),
		},
		{ label: "As at", value: report ? formatDateTime(report.asOf) : "—" },
	]
	if (search.lowStock === "true") meta.push({ label: "Filter", value: "Low stock only" })
	if (categoryName) meta.push({ label: "Category", value: categoryName })

	return (
		<div className="grid gap-4">
			<div className="flex flex-wrap items-end gap-3 print:hidden">
				{canSelectBranch ? (
					<div className="grid gap-1.5">
						<Label htmlFor="report-branch" className="text-xs text-muted-foreground">
							Branch
						</Label>
						<Select
							value={branchId ?? "ALL"}
							onValueChange={(value) =>
								setSearch({ reportBranch: value === "ALL" ? "all" : value })
							}
						>
							<SelectTrigger id="report-branch" className="w-52">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="ALL">All branches</SelectItem>
								{branches.map((branch) => (
									<SelectItem key={branch.id} value={branch.id}>
										{branch.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				) : (
					<p className="self-end pb-2 text-sm text-muted-foreground">
						Branch:{" "}
						<span className="font-medium text-foreground">
							{branches.find((branch) => branch.id === activeBranchId)?.name ?? "—"}
						</span>
					</p>
				)}

				<div className="grid gap-1.5">
					<Label htmlFor="report-category" className="text-xs text-muted-foreground">
						Category
					</Label>
					<Select
						value={search.categoryId ?? "ALL"}
						onValueChange={(value) =>
							setSearch({ categoryId: value === "ALL" ? undefined : value })
						}
					>
						<SelectTrigger id="report-category" className="w-48">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="ALL">All categories</SelectItem>
							{categories.map((category) => (
								<SelectItem key={category.id} value={category.id}>
									{category.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>

				<div className="grid gap-1.5">
					<Label htmlFor="report-from" className="text-xs text-muted-foreground">
						Movements from
					</Label>
					<Input
						id="report-from"
						type="date"
						className="w-40"
						value={from}
						onChange={(event) => setSearch({ from: event.target.value || undefined })}
					/>
				</div>
				<div className="grid gap-1.5">
					<Label htmlFor="report-to" className="text-xs text-muted-foreground">
						To
					</Label>
					<Input
						id="report-to"
						type="date"
						className="w-40"
						value={to}
						onChange={(event) => setSearch({ to: event.target.value || undefined })}
					/>
				</div>

				<div className="flex items-center gap-2 pb-2">
					<Switch
						id="report-low-stock"
						checked={search.lowStock === "true"}
						onCheckedChange={(checked) => setSearch({ lowStock: checked ? "true" : undefined })}
					/>
					<Label htmlFor="report-low-stock">Low stock only</Label>
				</div>

				<div className="ml-auto flex gap-2 pb-1">
					<ExportButton
						path={STOCK_REPORT_EXPORT_PATH}
						query={query}
						label="Stock report"
						disabled={!report || report.truncated}
						title={
							report?.truncated
								? "The export is refused while the report is capped; narrow the filter."
								: undefined
						}
						describedBy={report?.truncated ? "stock-report-cap" : undefined}
					/>
					<PrintButton label="stock report" disabled={!report} />
				</div>
			</div>

			<PrintSheet title="Stock report" meta={meta} />

			{reportQuery.isLoading ? (
				<output className="text-sm text-muted-foreground">Loading the stock report…</output>
			) : reportQuery.isError ? (
				<p className="text-sm text-destructive">{errorMessage}</p>
			) : report ? (
				<>
					{report.truncated ? (
						<div id="stock-report-cap">
							<StatusNote tone="warn" title="This report is capped">
								{formatCount(report.total)} stock rows match and the table shows the first{" "}
								{formatCount(report.rows.length)}. The totals on this page still cover every match,
								but the export is refused until the filter is narrowed by branch or category.
							</StatusNote>
						</div>
					) : null}

					<div className="grid gap-3 sm:grid-cols-3">
						<div className="rounded-md border p-3">
							<p className="text-xs text-muted-foreground">Products</p>
							<p className="mt-1 text-lg font-semibold tabular-nums">
								{formatCount(report.totals.products)}
							</p>
						</div>
						<div className="rounded-md border p-3">
							<p className="text-xs text-muted-foreground">Units on hand</p>
							<p className="mt-1 text-lg font-semibold tabular-nums">
								{formatCount(report.totals.quantityOnHand)}
							</p>
						</div>
						<div className="rounded-md border p-3">
							<p className="text-xs text-muted-foreground">Value at average cost</p>
							<p className="mt-1 text-lg font-semibold tabular-nums">
								{formatGhs(report.totals.valueMinor)}
							</p>
							<p className="text-xs text-muted-foreground">as at {formatDateTime(report.asOf)}</p>
						</div>
					</div>

					<div className="rounded-md border">
						<Table>
							<caption className="sr-only">
								Stock levels and their value at average cost, highest value first
							</caption>
							<TableHeader>
								<TableRow>
									<TableHead>SKU</TableHead>
									<TableHead>Product</TableHead>
									<TableHead>Category</TableHead>
									<TableHead>Branch</TableHead>
									<TableHead className="text-right">On hand</TableHead>
									<TableHead className="text-right">Avg cost</TableHead>
									<TableHead className="text-right">Value</TableHead>
									<TableHead className="text-right">Threshold</TableHead>
									<TableHead>Status</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{report.rows.length === 0 ? (
									<TableRow>
										<TableCell
											colSpan={9}
											className="py-8 text-center text-sm text-muted-foreground"
										>
											No stock matches these filters. Widen the branch, category or low-stock
											filter.
										</TableCell>
									</TableRow>
								) : (
									report.rows.map((row) => (
										<TableRow key={`${row.productId}-${row.branchId}`}>
											<TableCell className="font-mono text-xs">{row.sku}</TableCell>
											<TableCell className="font-medium">{row.productName}</TableCell>
											<TableCell className="text-muted-foreground">{row.categoryName}</TableCell>
											<TableCell className="font-mono text-xs">{row.branchCode}</TableCell>
											<TableCell className="text-right tabular-nums">
												{formatCount(row.quantityOnHand)}
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{formatGhs(row.avgCostMinor)}
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{formatGhs(row.valueMinor)}
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{row.threshold === null ? "—" : formatCount(row.threshold)}
											</TableCell>
											<TableCell>
												{row.belowThreshold ? (
													<StatusBadge tone="amber">Low</StatusBadge>
												) : (
													<StatusBadge tone="green">OK</StatusBadge>
												)}
											</TableCell>
										</TableRow>
									))
								)}
							</TableBody>
						</Table>
					</div>

					<div className="grid gap-3 lg:grid-cols-3">
						<section aria-labelledby="report-movements" className="rounded-md border p-3">
							<h2 id="report-movements" className="text-sm font-medium">
								Movements
							</h2>
							<p className="mt-1 text-xs text-muted-foreground">
								{formatCount(report.movements.inflow)} in, {formatCount(report.movements.outflow)}{" "}
								out
							</p>
							{report.movements.byType.length === 0 ? (
								<p className="mt-2 text-sm text-muted-foreground">No movements in this period.</p>
							) : (
								<dl className="mt-2 grid gap-1 text-sm">
									{report.movements.byType.map((row) => (
										<div key={row.type} className="flex justify-between gap-3">
											<dt className="text-muted-foreground">
												{MOVEMENT_META[row.type]?.label ?? row.type}
											</dt>
											<dd className="tabular-nums">{formatCount(row.quantity)}</dd>
										</div>
									))}
								</dl>
							)}
						</section>

						<section aria-labelledby="report-transfers" className="rounded-md border p-3">
							<h2 id="report-transfers" className="text-sm font-medium">
								Transfers
							</h2>
							<dl className="mt-2 grid gap-1 text-sm">
								<div className="flex justify-between gap-3">
									<dt className="text-muted-foreground">Dispatched</dt>
									<dd className="tabular-nums">{formatCount(report.transfers.dispatched)}</dd>
								</div>
								<div className="flex justify-between gap-3">
									<dt className="text-muted-foreground">Received</dt>
									<dd className="tabular-nums">{formatCount(report.transfers.received)}</dd>
								</div>
								<div className="flex justify-between gap-3">
									<dt className="text-muted-foreground">Short-closed</dt>
									<dd className="tabular-nums">{formatCount(report.transfers.shortClosed)}</dd>
								</div>
							</dl>
						</section>

						<section aria-labelledby="report-counts" className="rounded-md border p-3">
							<h2 id="report-counts" className="text-sm font-medium">
								Counts
							</h2>
							<dl className="mt-2 grid gap-1 text-sm">
								<div className="flex justify-between gap-3">
									<dt className="text-muted-foreground">Counts posted</dt>
									<dd className="tabular-nums">{formatCount(report.counts.completed)}</dd>
								</div>
								<div className="flex justify-between gap-3">
									<dt className="text-muted-foreground">Lines counted</dt>
									<dd className="tabular-nums">{formatCount(report.counts.countedLines)}</dd>
								</div>
								<div className="flex justify-between gap-3">
									<dt className="text-muted-foreground">Lines matched</dt>
									<dd className="tabular-nums">{formatCount(report.counts.matchedLines)}</dd>
								</div>
								<div className="flex justify-between gap-3">
									<dt className="text-muted-foreground">Variance value</dt>
									<dd className="tabular-nums">{formatGhs(report.counts.varianceValueMinor)}</dd>
								</div>
							</dl>
						</section>
					</div>
				</>
			) : null}
		</div>
	)
}
