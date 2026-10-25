import { formatBasisPoints, formatBucket, formatCount } from "@sceptre/shared"
import { useQuery } from "@tanstack/react-query"
import { getRouteApi } from "@tanstack/react-router"
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
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
import { formatGhs } from "#/lib/format"
import { analyticsReportOptions } from "../../api/analytics"
import { ChartCard } from "../../components/chart-card"
import { ExportButton } from "../../components/export-button"
import { KpiRow, KpiTile } from "../../components/kpi-tile"
import { PanelState } from "../../components/panel-state"
import { useAnalyticsBranch } from "../../hooks/use-analytics-filters"
import type { CreditResponse } from "../../types"
import { cedisTick, moneyTooltip } from "../../utils/format-chart"
import { toAnalyticsQuery } from "../../utils/search"

const routeApi = getRouteApi("/_authenticated/analytics")

const flowConfig = {
	charges: { label: "Charged", color: "var(--chart-1)" },
	repayments: { label: "Repaid", color: "var(--chart-2)" },
} satisfies ChartConfig

const distributionConfig = {
	balance: { label: "Balance", color: "var(--chart-1)" },
} satisfies ChartConfig

/**
 * Branch credit, never customer credit: the payload carries no customer identity (D15), so
 * the tab shows exposure and distribution, and a manager drills into customers from the
 * Customers section where the identity belongs.
 */
export function CreditTab() {
	const search = routeApi.useSearch()
	const { branchId } = useAnalyticsBranch(search.branchId)
	const query = toAnalyticsQuery(search, branchId)
	const report = useQuery(analyticsReportOptions<CreditResponse>("credit", query))

	if (report.isLoading) return <PanelState state="loading" label="Credit report" rows={6} />
	if (report.isError) {
		return (
			<PanelState
				state="error"
				label="Credit report"
				message={report.error instanceof ApiError ? report.error.message : undefined}
				onRetry={() => void report.refetch()}
			/>
		)
	}

	const data = report.data
	if (!data) return null

	const flow = data.series.map((point) => ({
		bucket: formatBucket(point.bucketStart, search.granularity ?? "day"),
		charges: point.chargesMinor,
		repayments: point.repaymentsMinor,
	}))
	const distribution = data.distribution.map((row) => ({
		label: row.label,
		balance: row.balanceMinor,
		count: row.count,
	}))

	return (
		<div className="grid gap-5">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<p className="text-sm text-muted-foreground">
					{formatCount(data.totals.customersWithBalance)} customers carry a balance ·{" "}
					{formatCount(data.totals.onHoldCount)} on hold
				</p>
				<ExportButton report="credit" query={query} label="Credit" />
			</div>

			<KpiRow>
				<KpiTile label="Credit outstanding" value={formatGhs(data.totals.outstandingMinor)} />
				<KpiTile
					label="Utilisation of limits"
					value={formatBasisPoints(data.totals.utilisationBp)}
					detail={`${formatGhs(data.totals.limitMinor)} of limits extended`}
				/>
				<KpiTile
					label="Over limit"
					value={formatCount(data.totals.overLimitCount)}
					detail={`${formatGhs(data.totals.overLimitExposureMinor)} beyond agreed limits`}
				/>
				<KpiTile
					label="Ledger cross-check"
					value={formatGhs(data.totals.reconcileDriftMinor)}
					detail="Projection minus ledger; zero means the two agree"
				/>
			</KpiRow>

			<ChartCard
				title="Charged against repaid"
				description="Credit posted and settled per bucket, in GHS."
				summary={`${formatGhs(data.totals.outstandingMinor)} is outstanding after this period's charges and repayments.`}
				table={{
					caption: "Credit charged and repaid per bucket",
					columns: [
						{ key: "bucket", label: "Period" },
						{ key: "charges", label: "Charged", align: "right" },
						{ key: "repayments", label: "Repaid", align: "right" },
					],
					rows: flow.map((point) => ({
						bucket: point.bucket,
						charges: formatGhs(point.charges),
						repayments: formatGhs(point.repayments),
					})),
				}}
			>
				<ChartContainer config={flowConfig} className="h-64 w-full">
					<AreaChart data={flow} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
						<CartesianGrid vertical={false} strokeDasharray="3 3" />
						<XAxis dataKey="bucket" tickLine={false} axisLine={false} tickMargin={8} />
						<YAxis width={64} tickLine={false} axisLine={false} tickFormatter={cedisTick} />
						<ChartTooltip
							content={<ChartTooltipContent indicator="line" formatter={moneyTooltip} />}
						/>
						<ChartLegend content={<ChartLegendContent />} />
						<Area
							dataKey="charges"
							type="monotone"
							fill="var(--color-charges)"
							fillOpacity={0.18}
							stroke="var(--color-charges)"
							strokeWidth={2}
						/>
						<Area
							dataKey="repayments"
							type="monotone"
							fill="var(--color-repayments)"
							fillOpacity={0.12}
							stroke="var(--color-repayments)"
							strokeWidth={2}
						/>
					</AreaChart>
				</ChartContainer>
			</ChartCard>

			<ChartCard
				title="Exposure by utilisation"
				description="Customers grouped by how much of their limit they have used."
				summary={`${formatCount(data.totals.overLimitCount)} customers are above their limit, holding ${formatGhs(data.totals.overLimitExposureMinor)} of excess.`}
				table={{
					caption: "Credit balance grouped by utilisation band",
					columns: [
						{ key: "label", label: "Band" },
						{ key: "count", label: "Customers", align: "right" },
						{ key: "balance", label: "Balance", align: "right" },
					],
					rows: distribution.map((row) => ({
						label: row.label,
						count: formatCount(row.count),
						balance: formatGhs(row.balance),
					})),
				}}
			>
				<ChartContainer config={distributionConfig} className="h-56 w-full">
					<BarChart data={distribution} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
						<CartesianGrid vertical={false} strokeDasharray="3 3" />
						<XAxis dataKey="label" tickLine={false} axisLine={false} />
						<YAxis width={64} tickLine={false} axisLine={false} tickFormatter={cedisTick} />
						<ChartTooltip
							content={<ChartTooltipContent indicator="dot" formatter={moneyTooltip} />}
						/>
						<Bar dataKey="balance" fill="var(--color-balance)" radius={[4, 4, 0, 0]} />
					</BarChart>
				</ChartContainer>
			</ChartCard>

			{data.byBranch.length > 0 ? (
				<Card>
					<CardHeader>
						<CardTitle className="text-sm">By branch</CardTitle>
					</CardHeader>
					<CardContent className="overflow-x-auto">
						<Table>
							<caption className="sr-only">Credit outstanding by branch</caption>
							<TableHeader>
								<TableRow>
									<TableHead scope="col">Branch</TableHead>
									<TableHead scope="col" className="text-right">
										Outstanding
									</TableHead>
									<TableHead scope="col" className="text-right">
										Limits
									</TableHead>
									<TableHead scope="col" className="text-right">
										Over limit
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{data.byBranch.map((row) => (
									<TableRow key={row.branchId}>
										<TableCell>
											{row.code} · {row.name}
										</TableCell>
										<TableCell className="text-right font-mono tabular-nums">
											{formatGhs(row.outstandingMinor)}
										</TableCell>
										<TableCell className="text-right font-mono tabular-nums">
											{formatGhs(row.limitMinor)}
										</TableCell>
										<TableCell className="text-right font-mono tabular-nums">
											{formatCount(row.overLimitCount)}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</CardContent>
				</Card>
			) : null}
		</div>
	)
}
