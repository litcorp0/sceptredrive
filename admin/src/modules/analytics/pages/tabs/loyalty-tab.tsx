import { formatBranchLabel, formatBucket, formatCount } from "@sceptre/shared"
import { useQuery } from "@tanstack/react-query"
import { getRouteApi } from "@tanstack/react-router"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { ExportButton } from "#/components/common/export-button"
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
import { KpiRow, KpiTile } from "../../components/kpi-tile"
import { PanelState } from "../../components/panel-state"
import { useAnalyticsBranch } from "../../hooks/use-analytics-filters"
import type { LoyaltyResponse } from "../../types"
import { pointsTooltip } from "../../utils/format-chart"
import { toAnalyticsQuery } from "../../utils/search"

const routeApi = getRouteApi("/_authenticated/analytics")

const pointsConfig = {
	issued: { label: "Issued", color: "var(--chart-1)" },
	redeemed: { label: "Redeemed", color: "var(--chart-2)" },
	expired: { label: "Expired", color: "var(--chart-3)" },
} satisfies ChartConfig

/**
 * Loyalty is organisation-wide: an account belongs to a customer, not a branch. Outstanding
 * points and their redemption value are therefore global, while the flow can be split by the
 * branch that issued or redeemed them.
 */
export function LoyaltyTab() {
	const search = routeApi.useSearch()
	const { branchId } = useAnalyticsBranch(search.branchId)
	const query = toAnalyticsQuery(search, branchId)
	const report = useQuery(analyticsReportOptions<LoyaltyResponse>("loyalty", query))

	if (report.isLoading) return <PanelState state="loading" label="Loyalty report" rows={6} />
	if (report.isError) {
		return (
			<PanelState
				state="error"
				label="Loyalty report"
				message={report.error instanceof ApiError ? report.error.message : undefined}
				onRetry={() => void report.refetch()}
			/>
		)
	}

	const data = report.data
	if (!data) return null

	const flow = data.series.map((point) => ({
		bucket: formatBucket(point.bucketStart, search.granularity ?? "day"),
		issued: point.issuedPoints,
		redeemed: point.redeemedPoints,
		expired: point.expiredPoints,
	}))

	return (
		<div className="grid grid-cols-1 gap-5">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<p className="text-sm text-muted-foreground">
					{formatCount(data.earnRate.earnPointsPerCedi)} point per GHS ·{" "}
					{formatCount(data.earnRate.pointsPerCedi)} points = GHS 1.00 · expires after{" "}
					{formatCount(data.earnRate.expiryMonths)} months
				</p>
				<ExportButton path="/api/analytics/loyalty/export" query={query} label="Loyalty" />
			</div>

			<KpiRow>
				<KpiTile label="Points issued" value={formatCount(data.totals.issuedPoints)} />
				<KpiTile label="Points redeemed" value={formatCount(data.totals.redeemedPoints)} />
				<KpiTile
					label="Liability (outstanding value)"
					value={formatGhs(data.totals.outstandingValueMinor)}
					detail={`${formatCount(data.totals.outstandingPoints)} points outstanding`}
				/>
				<KpiTile
					label={`Expiring in ${data.expiringSoon.days} days`}
					value={formatGhs(data.expiringSoon.valueMinor)}
					detail={`${formatCount(data.expiringSoon.points)} points`}
				/>
			</KpiRow>

			<ChartCard
				title="Points issued, redeemed, and expired"
				description="Points per bucket; issued is negative-free, so the bars stack up."
				summary={`${formatCount(data.totals.issuedPoints)} points were issued and ${formatCount(data.totals.redeemedPoints)} redeemed in this period.`}
				table={{
					caption: "Points issued, redeemed, and expired per bucket",
					columns: [
						{ key: "bucket", label: "Period" },
						{ key: "issued", label: "Issued", align: "right" },
						{ key: "redeemed", label: "Redeemed", align: "right" },
						{ key: "expired", label: "Expired", align: "right" },
					],
					rows: flow.map((point) => ({
						bucket: point.bucket,
						issued: formatCount(point.issued),
						redeemed: formatCount(point.redeemed),
						expired: formatCount(point.expired),
					})),
				}}
			>
				<ChartContainer config={pointsConfig} className="h-64 w-full">
					<BarChart data={flow} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
						<CartesianGrid vertical={false} strokeDasharray="3 3" />
						<XAxis dataKey="bucket" tickLine={false} axisLine={false} tickMargin={8} />
						<YAxis width={56} tickLine={false} axisLine={false} />
						<ChartTooltip
							content={<ChartTooltipContent indicator="dot" formatter={pointsTooltip} />}
						/>
						<ChartLegend content={<ChartLegendContent />} />
						<Bar dataKey="issued" stackId="points" fill="var(--color-issued)" />
						<Bar dataKey="redeemed" stackId="points" fill="var(--color-redeemed)" />
						<Bar
							dataKey="expired"
							stackId="points"
							fill="var(--color-expired)"
							radius={[4, 4, 0, 0]}
						/>
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
							<caption className="sr-only">Loyalty activity by branch</caption>
							<TableHeader>
								<TableRow>
									<TableHead scope="col">Branch</TableHead>
									<TableHead scope="col" className="text-right">
										Earned
									</TableHead>
									<TableHead scope="col" className="text-right">
										Redeemed
									</TableHead>
									<TableHead scope="col" className="text-right">
										Expired
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{data.byBranch.map((row) => (
									<TableRow key={row.branchId}>
										<TableCell>{formatBranchLabel({ name: row.name, code: row.code })}</TableCell>
										<TableCell className="text-right font-mono tabular-nums">
											{formatCount(row.earnedPoints)}
										</TableCell>
										<TableCell className="text-right font-mono tabular-nums">
											{formatCount(row.redeemedPoints)}
										</TableCell>
										<TableCell className="text-right font-mono tabular-nums">
											{formatCount(row.expiredPoints)}
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
