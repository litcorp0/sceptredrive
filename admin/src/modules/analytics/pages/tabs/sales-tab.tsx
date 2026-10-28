import { formatBucket, formatCount, formatDateTime } from "@sceptre/shared"
import { useQuery } from "@tanstack/react-query"
import { getRouteApi, Link } from "@tanstack/react-router"
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { ExportButton } from "#/components/common/export-button"
import { Pagination } from "#/components/common/pagination"
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card"
import {
	type ChartConfig,
	ChartContainer,
	ChartLegend,
	ChartLegendContent,
	ChartTooltip,
	ChartTooltipContent,
} from "#/components/ui/chart"
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
import { branchLabelFor } from "#/lib/branch-label"
import { formatGhs } from "#/lib/format"
import { analyticsSalesOptions } from "../../api/analytics"
import { ChartCard } from "../../components/chart-card"
import { KpiRow, KpiTile } from "../../components/kpi-tile"
import { PanelState } from "../../components/panel-state"
import { SortableHead } from "../../components/sortable-head"
import { useAnalyticsBranch } from "../../hooks/use-analytics-filters"
import { cedisTick, moneyTooltip } from "../../utils/format-chart"
import { toAnalyticsQuery, toReportQuery } from "../../utils/search"

const routeApi = getRouteApi("/_authenticated/analytics")
export const SALES_PAGE_SIZE = 20

const trendConfig = {
	take: { label: "Take", color: "var(--chart-1)" },
	tax: { label: "Tax", color: "var(--chart-2)" },
} satisfies ChartConfig

const hourConfig = {
	take: { label: "Take", color: "var(--chart-1)" },
} satisfies ChartConfig

export function SalesTab() {
	const search = routeApi.useSearch()
	const navigate = routeApi.useNavigate()
	const { branches } = useBranch()
	const { branchId } = useAnalyticsBranch(search.branchId)
	const query = toReportQuery(search, branchId, { limit: SALES_PAGE_SIZE })
	const report = useQuery(analyticsSalesOptions(query))

	if (report.isLoading) return <PanelState state="loading" label="Sales report" rows={8} />
	if (report.isError) {
		return (
			<PanelState
				state="error"
				label="Sales report"
				message={report.error instanceof ApiError ? report.error.message : undefined}
				onRetry={() => void report.refetch()}
			/>
		)
	}

	const data = report.data
	if (!data) return null
	const rows = data.rows
	const exportQuery = toAnalyticsQuery(search, branchId)

	if (data.totals.salesCount === 0) {
		return (
			<div className="grid grid-cols-1 gap-3">
				<div className="flex justify-end">
					<ExportButton path="/api/analytics/sales/export" query={exportQuery} label="Sales" />
				</div>
				<PanelState
					state="empty"
					label="Sales report"
					message="No sales recorded for this period — sales appear here once a terminal uploads a shift."
				/>
			</div>
		)
	}

	const trend = data.series.map((point) => ({
		bucket: formatBucket(point.bucketStart, search.granularity ?? "day"),
		take: point.takeMinor,
		tax: point.taxTotalMinor,
		sales: point.salesCount,
	}))
	const hours = data.byHour.map((point) => ({
		hour: `${String(point.hour).padStart(2, "0")}:00`,
		take: point.takeMinor,
		sales: point.salesCount,
	}))

	return (
		<div className="grid grid-cols-1 gap-5">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<p className="text-sm text-muted-foreground">
					{formatCount(data.totals.salesCount)} sales · {formatCount(data.totals.itemsSold)} items ·{" "}
					{formatGhs(data.totals.changeMinor)} change given
				</p>
				<ExportButton path="/api/analytics/sales/export" query={exportQuery} label="Sales" />
			</div>

			<KpiRow>
				<KpiTile
					label="Take"
					value={formatGhs(data.totals.takeMinor)}
					delta={data.deltas.take}
					subject="take"
				/>
				<KpiTile
					label="Sales"
					value={formatCount(data.totals.salesCount)}
					delta={data.deltas.salesCount}
					subject="sales"
				/>
				<KpiTile
					label="Average basket"
					value={formatGhs(data.totals.avgBasketMinor)}
					delta={data.deltas.avgBasket}
					subject="average basket"
				/>
				<KpiTile
					label="Tax collected"
					value={formatGhs(data.totals.tax.totalMinor)}
					detail={`VAT ${formatGhs(data.totals.tax.vatMinor)} · NHIL ${formatGhs(data.totals.tax.nhilMinor)} · GETFund ${formatGhs(data.totals.tax.getfundMinor)}`}
				/>
			</KpiRow>

			<ChartCard
				title="Take and tax by period"
				description="GHS on the vertical axis; every bucket in the period is shown, including days with no trade."
				summary={`${formatGhs(data.totals.takeMinor)} was taken across ${formatCount(data.totals.salesCount)} sales, of which ${formatGhs(data.totals.tax.totalMinor)} was tax.`}
				table={{
					caption: "Take and tax for each bucket in the period",
					columns: [
						{ key: "bucket", label: "Period" },
						{ key: "take", label: "Take", align: "right" },
						{ key: "tax", label: "Tax", align: "right" },
						{ key: "sales", label: "Sales", align: "right" },
					],
					rows: trend.map((point) => ({
						bucket: point.bucket,
						take: formatGhs(point.take),
						tax: formatGhs(point.tax),
						sales: formatCount(point.sales),
					})),
				}}
			>
				<ChartContainer config={trendConfig} className="h-64 w-full">
					<AreaChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
						<CartesianGrid vertical={false} strokeDasharray="3 3" />
						<XAxis dataKey="bucket" tickLine={false} axisLine={false} tickMargin={8} />
						<YAxis
							width={64}
							tickLine={false}
							axisLine={false}
							tickFormatter={cedisTick}
							label={{ value: "GHS", angle: -90, position: "insideLeft" }}
						/>
						<ChartTooltip
							content={<ChartTooltipContent indicator="line" formatter={moneyTooltip} />}
						/>
						<ChartLegend content={<ChartLegendContent />} />
						<Area
							dataKey="take"
							type="monotone"
							fill="var(--color-take)"
							fillOpacity={0.18}
							stroke="var(--color-take)"
							strokeWidth={2}
						/>
						<Area
							dataKey="tax"
							type="monotone"
							fill="var(--color-tax)"
							fillOpacity={0.12}
							stroke="var(--color-tax)"
							strokeWidth={2}
						/>
					</AreaChart>
				</ChartContainer>
			</ChartCard>

			<ChartCard
				title="When the till is busy"
				description="Take per hour of the Accra day, summed across the period."
				summary={`The busiest hour took ${formatGhs(Math.max(...data.byHour.map((point) => point.takeMinor)))}.`}
				table={{
					caption: "Take and sales for each hour of the day",
					columns: [
						{ key: "hour", label: "Hour" },
						{ key: "take", label: "Take", align: "right" },
						{ key: "sales", label: "Sales", align: "right" },
					],
					rows: hours.map((point) => ({
						hour: point.hour,
						take: formatGhs(point.take),
						sales: formatCount(point.sales),
					})),
				}}
			>
				<ChartContainer config={hourConfig} className="h-56 w-full">
					<BarChart data={hours} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
						<CartesianGrid vertical={false} strokeDasharray="3 3" />
						<XAxis dataKey="hour" tickLine={false} axisLine={false} interval={2} tickMargin={8} />
						<YAxis width={64} tickLine={false} axisLine={false} tickFormatter={cedisTick} />
						<ChartTooltip
							content={<ChartTooltipContent indicator="dot" formatter={moneyTooltip} />}
						/>
						<Bar dataKey="take" fill="var(--color-take)" radius={[4, 4, 0, 0]} />
					</BarChart>
				</ChartContainer>
			</ChartCard>

			<div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
				<BreakdownTable
					title="By terminal"
					rows={data.byTerminal}
					emptyLabel="No terminal sold in this period."
				/>
				<BreakdownTable
					title="By cashier"
					rows={data.byCashier}
					emptyLabel="No cashier sold in this period."
				/>
			</div>

			<Card>
				<CardHeader>
					<CardTitle className="text-sm">Sales</CardTitle>
				</CardHeader>
				<CardContent className="overflow-x-auto">
					<Table>
						<caption className="sr-only">Every sale in the period, newest first</caption>
						<TableHeader>
							<TableRow>
								<TableHead scope="col">Receipt</TableHead>
								<TableHead scope="col">When</TableHead>
								<TableHead scope="col">Branch</TableHead>
								<TableHead scope="col">Terminal</TableHead>
								<TableHead scope="col">Cashier</TableHead>
								<SortableHead
									label="Items"
									sortKey="count"
									currentSort={search.sort}
									currentDirection={search.direction}
									align="right"
								/>
								<SortableHead
									label="Take"
									sortKey="take"
									currentSort={search.sort}
									currentDirection={search.direction}
									align="right"
								/>
								<TableHead scope="col" className="text-right">
									Tax
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{rows.map((row) => (
								<TableRow key={row.receiptNumber}>
									<TableCell className="font-mono text-xs">
										<Link
											to="/pos/sales/$saleId"
											params={{ saleId: row.saleId }}
											className="hover:underline"
										>
											{row.receiptNumber}
										</Link>
									</TableCell>
									<TableCell>{formatDateTime(row.occurredAt)}</TableCell>
									<TableCell>{branchLabelFor(branches, { code: row.branchCode })}</TableCell>
									<TableCell>{row.terminalCode}</TableCell>
									<TableCell>{row.cashierName}</TableCell>
									<TableCell className="text-right font-mono tabular-nums">
										{formatCount(row.itemsSold)}
									</TableCell>
									<TableCell className="text-right font-mono tabular-nums">
										{formatGhs(row.takeMinor)}
									</TableCell>
									<TableCell className="text-right font-mono tabular-nums">
										{formatGhs(row.taxTotalMinor)}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
					<Pagination
						total={data.total}
						limit={SALES_PAGE_SIZE}
						offset={search.offset ?? 0}
						onOffsetChange={(offset) => {
							void navigate({ search: (prev: Record<string, unknown>) => ({ ...prev, offset }) })
						}}
					/>
				</CardContent>
			</Card>
		</div>
	)
}

function BreakdownTable({
	title,
	rows,
	emptyLabel,
}: {
	title: string
	rows: Array<{ id: string | null; label: string; takeMinor: number; salesCount: number }>
	emptyLabel: string
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-sm">{title}</CardTitle>
			</CardHeader>
			<CardContent>
				{rows.length === 0 ? (
					<p className="text-sm text-muted-foreground">{emptyLabel}</p>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead scope="col">Name</TableHead>
								<TableHead scope="col" className="text-right">
									Sales
								</TableHead>
								<TableHead scope="col" className="text-right">
									Take
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{rows.map((row) => (
								<TableRow key={row.id ?? row.label}>
									<TableCell>{row.label}</TableCell>
									<TableCell className="text-right font-mono tabular-nums">
										{formatCount(row.salesCount)}
									</TableCell>
									<TableCell className="text-right font-mono tabular-nums">
										{formatGhs(row.takeMinor)}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
			</CardContent>
		</Card>
	)
}
