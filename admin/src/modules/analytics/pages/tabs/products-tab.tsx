import { formatBasisPoints, formatCount } from "@sceptre/shared"
import { useQuery } from "@tanstack/react-query"
import { getRouteApi } from "@tanstack/react-router"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { ExportButton } from "#/components/common/export-button"
import { Pagination } from "#/components/common/pagination"
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card"
import {
	type ChartConfig,
	ChartContainer,
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
import { formatGhs } from "#/lib/format"
import { analyticsProductsOptions } from "../../api/analytics"
import { ChartCard } from "../../components/chart-card"
import { KpiRow, KpiTile } from "../../components/kpi-tile"
import { PanelState } from "../../components/panel-state"
import { SortableHead } from "../../components/sortable-head"
import { useAnalyticsBranch } from "../../hooks/use-analytics-filters"
import { cedisTick, moneyTooltip } from "../../utils/format-chart"
import { toAnalyticsQuery, toReportQuery } from "../../utils/search"

const routeApi = getRouteApi("/_authenticated/analytics")
const PAGE_SIZE = 20

const revenueConfig = {
	revenue: { label: "Revenue", color: "var(--chart-1)" },
} satisfies ChartConfig

export function ProductsTab() {
	const search = routeApi.useSearch()
	const navigate = routeApi.useNavigate()
	const { branchId } = useAnalyticsBranch(search.branchId)
	const query = toReportQuery(search, branchId, { limit: PAGE_SIZE })
	const report = useQuery(analyticsProductsOptions(query))

	if (report.isLoading) return <PanelState state="loading" label="Product report" rows={8} />
	if (report.isError) {
		return (
			<PanelState
				state="error"
				label="Product report"
				message={report.error instanceof ApiError ? report.error.message : undefined}
				onRetry={() => void report.refetch()}
			/>
		)
	}

	const data = report.data
	if (!data) return null
	const exportQuery = toAnalyticsQuery(search, branchId)

	if (data.totals.unitsSold === 0) {
		return (
			<div className="grid grid-cols-1 gap-3">
				<div className="flex justify-end">
					<ExportButton
						path="/api/analytics/products/export"
						query={exportQuery}
						label="Products"
					/>
				</div>
				<PanelState
					state="empty"
					label="Product report"
					message="Nothing sold in this period, so there is no product performance to show."
				/>
			</div>
		)
	}

	const top = data.top.map((product) => ({
		name: product.name,
		revenue: product.revenueBaseMinor,
		units: product.quantity,
	}))
	const categories = data.byCategory.map((slice) => ({
		name: slice.name,
		revenue: slice.revenueBaseMinor,
		units: slice.quantity,
	}))

	return (
		<div className="grid grid-cols-1 gap-5">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<p className="text-sm text-muted-foreground">
					{formatCount(data.totals.distinctProducts)} products ·{" "}
					{formatCount(data.totals.unitsSold)} units · top five hold{" "}
					{formatBasisPoints(data.concentration.top5RevenueBp)} of revenue
				</p>
				<ExportButton path="/api/analytics/products/export" query={exportQuery} label="Products" />
			</div>

			<KpiRow>
				<KpiTile label="Revenue (ex-tax)" value={formatGhs(data.totals.revenueBaseMinor)} />
				<KpiTile label="Gross profit" value={formatGhs(data.totals.grossProfitMinor)} />
				<KpiTile
					label="Gross margin"
					value={formatBasisPoints(data.totals.marginBp)}
					detail={
						data.totals.marginBp === null && data.totals.uncostedRevenueMinor > 0
							? `No cost known — ${formatGhs(data.totals.uncostedRevenueMinor)} sold without one`
							: "Tax-exclusive revenue minus frozen cost"
					}
				/>
				<KpiTile label="Units sold" value={formatCount(data.totals.unitsSold)} />
			</KpiRow>

			<ChartCard
				title="Top products by revenue"
				description="Tax-exclusive revenue; the axis is GHS."
				summary={`The five best sellers hold ${formatBasisPoints(data.concentration.top5RevenueBp)} of the period's revenue.`}
				table={{
					caption: "Top products by tax-exclusive revenue",
					columns: [
						{ key: "name", label: "Product" },
						{ key: "units", label: "Units", align: "right" },
						{ key: "revenue", label: "Revenue", align: "right" },
					],
					rows: top.map((product) => ({
						name: product.name,
						units: formatCount(product.units),
						revenue: formatGhs(product.revenue),
					})),
				}}
			>
				<ChartContainer config={revenueConfig} className="h-72 w-full">
					<BarChart data={top} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 8 }}>
						<CartesianGrid horizontal={false} strokeDasharray="3 3" />
						<XAxis type="number" tickLine={false} axisLine={false} tickFormatter={cedisTick} />
						<YAxis
							type="category"
							dataKey="name"
							width={160}
							tickLine={false}
							axisLine={false}
							tick={{ fontSize: 11 }}
						/>
						<ChartTooltip
							content={<ChartTooltipContent indicator="dot" formatter={moneyTooltip} />}
						/>
						<Bar dataKey="revenue" fill="var(--color-revenue)" radius={[0, 4, 4, 0]} />
					</BarChart>
				</ChartContainer>
			</ChartCard>

			<ChartCard
				title="Revenue by category"
				description="Top four categories and an exact Other, in GHS."
				summary={`${categories.length} categories contributed to revenue this period.`}
				table={{
					caption: "Tax-exclusive revenue by category",
					columns: [
						{ key: "name", label: "Category" },
						{ key: "units", label: "Units", align: "right" },
						{ key: "revenue", label: "Revenue", align: "right" },
					],
					rows: categories.map((slice) => ({
						name: slice.name,
						units: formatCount(slice.units),
						revenue: formatGhs(slice.revenue),
					})),
				}}
			>
				<ChartContainer config={revenueConfig} className="h-64 w-full">
					<BarChart data={categories} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
						<CartesianGrid vertical={false} strokeDasharray="3 3" />
						<XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
						<YAxis width={64} tickLine={false} axisLine={false} tickFormatter={cedisTick} />
						<ChartTooltip
							content={<ChartTooltipContent indicator="dot" formatter={moneyTooltip} />}
						/>
						<Bar dataKey="revenue" fill="var(--color-revenue)" radius={[4, 4, 0, 0]} />
					</BarChart>
				</ChartContainer>
			</ChartCard>

			<Card>
				<CardHeader>
					<CardTitle className="text-sm">Product performance</CardTitle>
				</CardHeader>
				<CardContent className="overflow-x-auto">
					<Table>
						<caption className="sr-only">Every product sold in the period</caption>
						<TableHeader>
							<TableRow>
								<TableHead scope="col">Product</TableHead>
								<TableHead scope="col">SKU</TableHead>
								<SortableHead
									label="Units"
									sortKey="units"
									currentSort={search.sort}
									currentDirection={search.direction}
									align="right"
								/>
								<SortableHead
									label="Revenue"
									sortKey="revenue"
									currentSort={search.sort}
									currentDirection={search.direction}
									align="right"
								/>
								<TableHead scope="col" className="text-right">
									Cost
								</TableHead>
								<TableHead scope="col" className="text-right">
									Profit
								</TableHead>
								<SortableHead
									label="Margin"
									sortKey="margin"
									currentSort={search.sort}
									currentDirection={search.direction}
									align="right"
								/>
							</TableRow>
						</TableHeader>
						<TableBody>
							{data.rows.map((row) => (
								<TableRow key={row.productId}>
									<TableCell>{row.name}</TableCell>
									<TableCell className="font-mono text-xs">{row.sku}</TableCell>
									<TableCell className="text-right font-mono tabular-nums">
										{formatCount(row.quantity)}
									</TableCell>
									<TableCell className="text-right font-mono tabular-nums">
										{formatGhs(row.revenueBaseMinor)}
									</TableCell>
									<TableCell className="text-right font-mono tabular-nums">
										{formatGhs(row.costMinor)}
									</TableCell>
									<TableCell className="text-right font-mono tabular-nums">
										{formatGhs(row.grossProfitMinor)}
									</TableCell>
									<TableCell
										className="text-right font-mono tabular-nums"
										title={row.marginBp === null ? "No cost recorded for these sales" : undefined}
									>
										{formatBasisPoints(row.marginBp)}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
					<Pagination
						total={data.total}
						limit={PAGE_SIZE}
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
