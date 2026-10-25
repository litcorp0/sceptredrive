import { formatBucket, formatCount } from "@sceptre/shared"
import { useQuery } from "@tanstack/react-query"
import { getRouteApi } from "@tanstack/react-router"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
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
import { analyticsReportOptions } from "../../api/analytics"
import { ChartCard } from "../../components/chart-card"
import { ExportButton } from "../../components/export-button"
import { KpiRow, KpiTile } from "../../components/kpi-tile"
import { PanelState } from "../../components/panel-state"
import { useAnalyticsBranch } from "../../hooks/use-analytics-filters"
import type { InventoryResponse } from "../../types"
import { cedisTick, moneyTooltip } from "../../utils/format-chart"
import { toAnalyticsQuery } from "../../utils/search"

const routeApi = getRouteApi("/_authenticated/analytics")

const flowConfig = {
	received: { label: "Received", color: "var(--chart-1)" },
	sold: { label: "Sold", color: "var(--chart-2)" },
	adjusted: { label: "Adjusted", color: "var(--chart-3)" },
} satisfies ChartConfig

/**
 * Stock value is `quantity_on_hand × avg_cost_minor`, summed server-side. Movements are
 * posted to the ledger on `created_at` (there is no business date on a movement), so the flow
 * chart is "when the ledger received it", not "when it was sold".
 */
export function InventoryTab() {
	const search = routeApi.useSearch()
	const { branchId } = useAnalyticsBranch(search.branchId)
	const query = toAnalyticsQuery(search, branchId)
	const report = useQuery(analyticsReportOptions<InventoryResponse>("inventory", query))

	if (report.isLoading) return <PanelState state="loading" label="Inventory report" rows={8} />
	if (report.isError) {
		return (
			<PanelState
				state="error"
				label="Inventory report"
				message={report.error instanceof ApiError ? report.error.message : undefined}
				onRetry={() => void report.refetch()}
			/>
		)
	}

	const data = report.data
	if (!data) return null

	const flow = data.flow.map((point) => ({
		bucket: formatBucket(point.bucketStart, search.granularity ?? "day"),
		received: point.receivedUnits,
		sold: point.soldUnits,
		adjusted: point.adjustedUnits,
	}))
	const branches = data.byBranch.map((row) => ({
		name: row.code,
		value: row.stockValueMinor,
	}))

	return (
		<div className="grid grid-cols-1 gap-5">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<p className="text-sm text-muted-foreground">
					{formatCount(data.totals.distinctProducts)} products ·{" "}
					{formatCount(data.totals.unitsOnHand)} units on hand · {formatCount(data.deadStock.count)}{" "}
					with stock but no movement
				</p>
				<ExportButton report="inventory" query={query} label="Inventory" />
			</div>

			<KpiRow>
				<KpiTile
					label="Stock value at average cost"
					value={formatGhs(data.totals.stockValueMinor)}
				/>
				<KpiTile label="Units on hand" value={formatCount(data.totals.unitsOnHand)} />
				<KpiTile
					label="Below threshold"
					value={formatCount(data.totals.lowStockCount)}
					detail={`${formatCount(data.totals.thresholdCount)} thresholds set`}
				/>
				<KpiTile label="Out of stock" value={formatCount(data.totals.outOfStockCount)} />
			</KpiRow>

			<ChartCard
				title="Stock movements"
				description="Units received, sold, and adjusted per bucket, from the append-only ledger."
				summary={`${formatGhs(data.flow.reduce((total, point) => total + point.receivedValueMinor, 0))} of stock was received in this period.`}
				table={{
					caption: "Units received, sold, and adjusted per bucket",
					columns: [
						{ key: "bucket", label: "Period" },
						{ key: "received", label: "Received", align: "right" },
						{ key: "sold", label: "Sold", align: "right" },
						{ key: "adjusted", label: "Adjusted", align: "right" },
					],
					rows: flow.map((point) => ({
						bucket: point.bucket,
						received: formatCount(point.received),
						sold: formatCount(point.sold),
						adjusted: formatCount(point.adjusted),
					})),
				}}
			>
				<ChartContainer config={flowConfig} className="h-64 w-full">
					<BarChart data={flow} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
						<CartesianGrid vertical={false} strokeDasharray="3 3" />
						<XAxis dataKey="bucket" tickLine={false} axisLine={false} tickMargin={8} />
						<YAxis width={56} tickLine={false} axisLine={false} />
						<ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
						<Bar dataKey="received" stackId="flow" fill="var(--color-received)" />
						<Bar dataKey="sold" stackId="flow" fill="var(--color-sold)" />
						<Bar
							dataKey="adjusted"
							stackId="flow"
							fill="var(--color-adjusted)"
							radius={[4, 4, 0, 0]}
						/>
					</BarChart>
				</ChartContainer>
			</ChartCard>

			{data.byBranch.length > 1 ? (
				<ChartCard
					title="Stock value by branch"
					description="Average cost valuation, in GHS."
					summary={`${data.byBranch.length} branches hold stock; the highest is ${formatGhs(Math.max(...branches.map((row) => row.value)))}.`}
					table={{
						caption: "Stock value by branch",
						columns: [
							{ key: "name", label: "Branch" },
							{ key: "value", label: "Value", align: "right" },
						],
						rows: branches.map((row) => ({
							name: row.name,
							value: formatGhs(row.value),
						})),
					}}
				>
					<ChartContainer
						config={{ value: { label: "Stock value", color: "var(--chart-1)" } }}
						className="h-56 w-full"
					>
						<BarChart data={branches} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
							<CartesianGrid vertical={false} strokeDasharray="3 3" />
							<XAxis dataKey="name" tickLine={false} axisLine={false} />
							<YAxis width={64} tickLine={false} axisLine={false} tickFormatter={cedisTick} />
							<ChartTooltip
								content={<ChartTooltipContent indicator="dot" formatter={moneyTooltip} />}
							/>
							<Bar dataKey="value" fill="var(--color-value)" radius={[4, 4, 0, 0]} />
						</BarChart>
					</ChartContainer>
				</ChartCard>
			) : null}

			<Card>
				<CardHeader>
					<CardTitle className="text-sm">Top movers by units sold</CardTitle>
				</CardHeader>
				<CardContent>
					{data.topMovers.length === 0 ? (
						<p className="text-sm text-muted-foreground">Nothing sold in this period.</p>
					) : (
						<Table>
							<caption className="sr-only">Products with the most units sold</caption>
							<TableHeader>
								<TableRow>
									<TableHead scope="col">Product</TableHead>
									<TableHead scope="col">SKU</TableHead>
									<TableHead scope="col" className="text-right">
										Units sold
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{data.topMovers.map((row) => (
									<TableRow key={row.productId}>
										<TableCell>{row.name}</TableCell>
										<TableCell className="font-mono text-xs">{row.sku}</TableCell>
										<TableCell className="text-right font-mono tabular-nums">
											{formatCount(row.unitsSold)}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>
		</div>
	)
}
