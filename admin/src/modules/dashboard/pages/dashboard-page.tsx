import { formatBasisPoints, formatBucket, formatCount } from "@sceptre/shared"
import { useQuery } from "@tanstack/react-query"
import { getRouteApi, Link } from "@tanstack/react-router"
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { PageHeader } from "#/components/common/page-header"
import { Button } from "#/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card"
import {
	type ChartConfig,
	ChartContainer,
	ChartLegend,
	ChartLegendContent,
	ChartTooltip,
	ChartTooltipContent,
} from "#/components/ui/chart"
import { useBranch } from "#/lib/branch-context"
import { formatGhs } from "#/lib/format"
import {
	analyticsOverviewOptions,
	analyticsReportOptions,
	ChartCard,
	type CreditResponse,
	cedisTick,
	FilterBar,
	type InventoryResponse,
	KpiRow,
	KpiTile,
	moneyTooltip,
	PanelState,
	toAnalyticsQuery,
} from "#/modules/analytics"
import { NeedsAttention } from "../components/needs-attention"
import { RecentActivity } from "../components/recent-activity"
import { TillLine } from "../components/till-line"

const routeApi = getRouteApi("/_authenticated/")

const trendConfig = {
	take: { label: "Take", color: "var(--chart-1)" },
	tax: { label: "Tax", color: "var(--chart-2)" },
} satisfies ChartConfig

const mixConfig = {
	amount: { label: "Amount", color: "var(--chart-1)" },
} satisfies ChartConfig

const rankingConfig = {
	take: { label: "Take", color: "var(--chart-1)" },
} satisfies ChartConfig

/**
 * The executive dashboard.
 *
 * Opens with the Till Line, then four tiles, then the charts that explain them. Every figure
 * is a field from `/api/analytics/overview` (plus the credit and inventory state figures the
 * header tiles need); nothing is summed in the browser.
 */
export function DashboardPage() {
	const search = routeApi.useSearch()
	const navigate = routeApi.useNavigate()
	const { activeBranch, activeBranchId, canSelectBranch } = useBranch()

	// P9-D4: URL branch wins when present, otherwise the shell switcher. A manager never sends
	// one, so a hand-edited parameter cannot turn their page into a 403.
	const branchId = canSelectBranch ? (search.branchId ?? activeBranchId ?? undefined) : undefined
	const query = toAnalyticsQuery(search, branchId)

	const overview = useQuery(analyticsOverviewOptions(query))
	const credit = useQuery(analyticsReportOptions<CreditResponse>("credit", query))
	const inventory = useQuery(analyticsReportOptions<InventoryResponse>("inventory", query))

	const branchLabel = canSelectBranch
		? branchId
			? (activeBranch?.code ?? "the selected branch")
			: "all branches"
		: (activeBranch?.name ?? "your branch")

	if (overview.isLoading) {
		return (
			<div className="grid grid-cols-1 gap-5">
				<PageHeader title={`Today at ${branchLabel}`} />
				<PanelState state="loading" label="Dashboard" rows={8} />
			</div>
		)
	}

	if (overview.isError) {
		return (
			<div className="grid grid-cols-1 gap-5">
				<PageHeader title={`Today at ${branchLabel}`} />
				<PanelState
					state="error"
					label="Dashboard"
					onRetry={() => void overview.refetch()}
					message={
						overview.error instanceof Error ? overview.error.message : "The server did not answer."
					}
				/>
			</div>
		)
	}

	const data = overview.data
	if (!data) return null

	const granularity = search.granularity ?? "day"
	const trend = data.series.map((point) => ({
		bucket: formatBucket(point.bucketStart, granularity),
		take: point.takeMinor,
		tax: point.taxTotalMinor,
		sales: point.salesCount,
	}))
	const mix = data.tenderMix.map((slice) => ({
		label: slice.method === "CASH" ? "Cash" : slice.method === "CREDIT" ? "Credit" : slice.method,
		amount: slice.amountMinor,
	}))
	const top = data.topProducts.map((product) => ({
		name: product.name,
		revenue: product.revenueBaseMinor,
		units: product.quantity,
	}))
	const categories = data.categorySplit.map((slice) => ({
		name: slice.name,
		revenue: slice.revenueBaseMinor,
	}))
	const ranking = data.branchRanking.map((branch) => ({
		name: branch.code,
		take: branch.takeMinor,
	}))

	return (
		<div className="grid grid-cols-1 gap-5">
			<PageHeader
				title={`Today at ${branchLabel}`}
				description="Reconciled sales, tax, stock, credit, and loyalty for the selected period. Drill into any figure on Analytics."
				actions={
					<Button asChild variant="outline" size="sm">
						<Link to="/analytics">Open analytics</Link>
					</Button>
				}
			/>

			<FilterBar
				search={search}
				branchLabel={branchLabel}
				onChange={(patch) => {
					const { from, to, granularity, branchId: nextBranch } = patch
					void navigate({
						search: (prev) => ({
							...prev,
							from,
							to,
							granularity,
							branchId: nextBranch,
						}),
					})
				}}
			/>

			<TillLine totals={data.totals} />

			<KpiRow>
				<KpiTile
					label="Revenue (ex-tax)"
					value={formatGhs(data.totals.revenueBaseMinor)}
					delta={data.deltas.take}
					subject="revenue"
					spark={data.series.map((point) => ({
						bucketStart: point.bucketStart,
						value: point.takeMinor - point.taxTotalMinor,
					}))}
				/>
				<KpiTile
					label="Gross margin"
					value={formatBasisPoints(data.totals.marginBp)}
					detail={`${formatGhs(data.totals.grossProfitMinor)} gross profit`}
					delta={{
						currentMinor: data.totals.grossProfitMinor,
						previousMinor: data.deltas.grossProfit.previousMinor,
						deltaBp: data.deltas.grossProfit.deltaBp,
					}}
					subject="gross profit"
				/>
				<KpiTile
					label="Credit outstanding"
					value={
						credit.isLoading
							? "…"
							: credit.data
								? formatGhs(credit.data.totals.outstandingMinor)
								: "—"
					}
					detail={
						credit.data
							? `${formatCount(credit.data.totals.overLimitCount)} over limit`
							: "Branch credit ledger"
					}
				/>
				<KpiTile
					label="Stock value at cost"
					value={
						inventory.isLoading
							? "…"
							: inventory.data
								? formatGhs(inventory.data.totals.stockValueMinor)
								: "—"
					}
					detail={
						inventory.data
							? `${formatCount(inventory.data.totals.lowStockCount)} below threshold`
							: "Average cost valuation"
					}
				/>
			</KpiRow>

			<div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
				<ChartCard
					title="Take and tax"
					description="GHS on the vertical axis; every bucket in the period, including days with no trade."
					summary={`${formatGhs(data.totals.takeMinor)} was taken across ${formatCount(data.totals.salesCount)} sales this period.`}
					table={{
						caption: "Take and tax per bucket",
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
					<ChartContainer config={trendConfig} className="h-56 w-full">
						<AreaChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
							<CartesianGrid vertical={false} strokeDasharray="3 3" />
							<XAxis dataKey="bucket" tickLine={false} axisLine={false} tickMargin={8} />
							<YAxis width={64} tickLine={false} axisLine={false} tickFormatter={cedisTick} />
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
					title="How the money arrived"
					description="Cash is the till's share after electronic tenders and credit, in GHS."
					summary={mix.map((slice) => `${slice.label} ${formatGhs(slice.amount)}`).join(" · ")}
					table={{
						caption: "Take by tender method",
						columns: [
							{ key: "label", label: "Method" },
							{ key: "amount", label: "Amount", align: "right" },
						],
						rows: mix.map((slice) => ({
							label: slice.label,
							amount: formatGhs(slice.amount),
						})),
					}}
				>
					<ChartContainer config={mixConfig} className="h-56 w-full">
						<BarChart data={mix} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
							<CartesianGrid vertical={false} strokeDasharray="3 3" />
							<XAxis dataKey="label" tickLine={false} axisLine={false} />
							<YAxis width={64} tickLine={false} axisLine={false} tickFormatter={cedisTick} />
							<ChartTooltip
								content={<ChartTooltipContent indicator="dot" formatter={moneyTooltip} />}
							/>
							<Bar dataKey="amount" fill="var(--color-amount)" radius={[4, 4, 0, 0]} />
						</BarChart>
					</ChartContainer>
				</ChartCard>

				<ChartCard
					title="Top products"
					description="Tax-exclusive revenue, in GHS."
					summary={`The best seller contributed ${formatGhs(top[0]?.revenue ?? 0)}.`}
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
					<ChartContainer config={rankingConfig} className="h-56 w-full">
						<BarChart
							data={top}
							layout="vertical"
							margin={{ top: 4, right: 16, bottom: 0, left: 8 }}
						>
							<CartesianGrid horizontal={false} strokeDasharray="3 3" />
							<XAxis type="number" tickLine={false} axisLine={false} tickFormatter={cedisTick} />
							<YAxis
								type="category"
								dataKey="name"
								width={140}
								tickLine={false}
								axisLine={false}
								tick={{ fontSize: 11 }}
							/>
							<ChartTooltip
								content={<ChartTooltipContent indicator="dot" formatter={moneyTooltip} />}
							/>
							<Bar dataKey="revenue" fill="var(--color-take)" radius={[0, 4, 4, 0]} />
						</BarChart>
					</ChartContainer>
				</ChartCard>

				<ChartCard
					title="Revenue by category"
					description="Top four categories and an exact Other, in GHS."
					summary={`${categories.length} categories contributed revenue this period.`}
					table={{
						caption: "Tax-exclusive revenue by category",
						columns: [
							{ key: "name", label: "Category" },
							{ key: "revenue", label: "Revenue", align: "right" },
						],
						rows: categories.map((slice) => ({
							name: slice.name,
							revenue: formatGhs(slice.revenue),
						})),
					}}
				>
					<ChartContainer config={rankingConfig} className="h-56 w-full">
						<BarChart data={categories} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
							<CartesianGrid vertical={false} strokeDasharray="3 3" />
							<XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
							<YAxis width={64} tickLine={false} axisLine={false} tickFormatter={cedisTick} />
							<ChartTooltip
								content={<ChartTooltipContent indicator="dot" formatter={moneyTooltip} />}
							/>
							<Bar dataKey="revenue" fill="var(--color-take)" radius={[4, 4, 0, 0]} />
						</BarChart>
					</ChartContainer>
				</ChartCard>
			</div>

			{canSelectBranch && ranking.length > 0 ? (
				<ChartCard
					title="Branch comparison"
					description="Take by branch for the same period, in GHS."
					summary={`${ranking[0]?.name} leads with ${formatGhs(ranking[0]?.take ?? 0)}.`}
					table={{
						caption: "Take by branch",
						columns: [
							{ key: "name", label: "Branch" },
							{ key: "take", label: "Take", align: "right" },
						],
						rows: ranking.map((branch) => ({
							name: branch.name,
							take: formatGhs(branch.take),
						})),
					}}
				>
					<ChartContainer config={rankingConfig} className="h-56 w-full">
						<BarChart
							data={ranking}
							layout="vertical"
							margin={{ top: 4, right: 16, bottom: 0, left: 8 }}
						>
							<CartesianGrid horizontal={false} strokeDasharray="3 3" />
							<XAxis type="number" tickLine={false} axisLine={false} tickFormatter={cedisTick} />
							<YAxis type="category" dataKey="name" width={90} tickLine={false} axisLine={false} />
							<ChartTooltip
								content={<ChartTooltipContent indicator="dot" formatter={moneyTooltip} />}
							/>
							<Bar dataKey="take" fill="var(--color-take)" radius={[0, 4, 4, 0]} />
						</BarChart>
					</ChartContainer>
				</ChartCard>
			) : null}

			<NeedsAttention attention={data.attention} />

			<Card>
				<CardHeader>
					<CardTitle className="text-sm">Recent activity</CardTitle>
				</CardHeader>
				<CardContent>
					<RecentActivity />
				</CardContent>
			</Card>
		</div>
	)
}
