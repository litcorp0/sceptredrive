import { formatBasisPoints, formatBucket, formatCount } from "@sceptre/shared"
import { useQuery } from "@tanstack/react-query"
import { getRouteApi } from "@tanstack/react-router"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
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
import { analyticsTaxOptions } from "../../api/analytics"
import { ChartCard } from "../../components/chart-card"
import { ExportButton } from "../../components/export-button"
import { KpiRow, KpiTile } from "../../components/kpi-tile"
import { PanelState } from "../../components/panel-state"
import { useAnalyticsBranch } from "../../hooks/use-analytics-filters"
import { cedisTick, moneyTooltip } from "../../utils/format-chart"
import { toAnalyticsQuery } from "../../utils/search"

const routeApi = getRouteApi("/_authenticated/analytics")

const taxConfig = {
	vat: { label: "VAT", color: "var(--chart-1)" },
	nhil: { label: "NHIL", color: "var(--chart-2)" },
	getfund: { label: "GETFund", color: "var(--chart-3)" },
} satisfies ChartConfig

/**
 * RPT-02 — the tax report.
 *
 * Headline figures come from the sale header (the charged money); the category split comes
 * from the lines. When a sale was stored with a mismatch the two disagree, and the drift note
 * says so rather than letting a reader assume one of them is wrong.
 */
export function TaxTab() {
	const search = routeApi.useSearch()
	const { branchId } = useAnalyticsBranch(search.branchId)
	const query = toAnalyticsQuery(search, branchId)
	const report = useQuery(analyticsTaxOptions(query))

	if (report.isLoading) return <PanelState state="loading" label="Tax report" rows={8} />
	if (report.isError) {
		return (
			<PanelState
				state="error"
				label="Tax report"
				message={report.error instanceof ApiError ? report.error.message : undefined}
				onRetry={() => void report.refetch()}
			/>
		)
	}

	const data = report.data
	if (!data) return null

	if (data.totals.salesCount === 0) {
		return (
			<div className="grid gap-3">
				<div className="flex justify-end">
					<ExportButton report="tax" query={query} label="Tax" />
				</div>
				<PanelState
					state="empty"
					label="Tax report"
					message="No sales are recorded for this period, so no tax was charged."
				/>
			</div>
		)
	}

	const trend = data.series.map((point) => ({
		bucket: formatBucket(point.bucketStart, search.granularity ?? "day"),
		vat: point.vatMinor,
		nhil: point.nhilMinor,
		getfund: point.getfundMinor,
		total: point.totalMinor,
	}))

	return (
		<div className="grid gap-5">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<p className="text-sm text-muted-foreground">
					Rates: VAT {formatBasisPoints(data.rates.vatBp)} · NHIL{" "}
					{formatBasisPoints(data.rates.nhilBp)} · GETFund {formatBasisPoints(data.rates.getfundBp)}{" "}
					on one base
				</p>
				<ExportButton report="tax" query={query} label="Tax" />
			</div>

			<KpiRow>
				<KpiTile
					label="VAT"
					value={formatGhs(data.totals.vatMinor)}
					detail={`${formatBasisPoints(data.rates.vatBp)} of the taxable base`}
				/>
				<KpiTile label="NHIL" value={formatGhs(data.totals.nhilMinor)} />
				<KpiTile label="GETFund" value={formatGhs(data.totals.getfundMinor)} />
				<KpiTile
					label="Tax collected"
					value={formatGhs(data.totals.totalMinor)}
					detail={`On a base of ${formatGhs(data.totals.baseMinor)}`}
				/>
			</KpiRow>

			{data.driftMinor.tax === 0 && data.driftMinor.revenue === 0 ? null : (
				<div className="rounded-lg border border-warn/40 bg-warn/5 p-3 text-sm">
					<p className="font-medium">Header and line figures differ for this period.</p>
					<p className="mt-1 text-xs text-muted-foreground">
						{data.driftExplanation} Revenue drift {formatGhs(data.driftMinor.revenue)}; tax drift{" "}
						{formatGhs(data.driftMinor.tax)}.
					</p>
				</div>
			)}

			<ChartCard
				title="Tax by period"
				description="VAT, NHIL, and GETFund stacked, in GHS."
				summary={`${formatGhs(data.totals.totalMinor)} of tax was collected across ${formatCount(data.totals.salesCount)} sales.`}
				table={{
					caption: "Tax components for each bucket in the period",
					columns: [
						{ key: "bucket", label: "Period" },
						{ key: "vat", label: "VAT", align: "right" },
						{ key: "nhil", label: "NHIL", align: "right" },
						{ key: "getfund", label: "GETFund", align: "right" },
						{ key: "total", label: "Total", align: "right" },
					],
					rows: trend.map((point) => ({
						bucket: point.bucket,
						vat: formatGhs(point.vat),
						nhil: formatGhs(point.nhil),
						getfund: formatGhs(point.getfund),
						total: formatGhs(point.total),
					})),
				}}
			>
				<ChartContainer config={taxConfig} className="h-64 w-full">
					<BarChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
						<CartesianGrid vertical={false} strokeDasharray="3 3" />
						<XAxis dataKey="bucket" tickLine={false} axisLine={false} tickMargin={8} />
						<YAxis width={64} tickLine={false} axisLine={false} tickFormatter={cedisTick} />
						<ChartTooltip
							content={<ChartTooltipContent indicator="dot" formatter={moneyTooltip} />}
						/>
						<ChartLegend content={<ChartLegendContent />} />
						<Bar dataKey="vat" stackId="tax" fill="var(--color-vat)" />
						<Bar dataKey="nhil" stackId="tax" fill="var(--color-nhil)" />
						<Bar
							dataKey="getfund"
							stackId="tax"
							fill="var(--color-getfund)"
							radius={[4, 4, 0, 0]}
						/>
					</BarChart>
				</ChartContainer>
			</ChartCard>

			<Card>
				<CardHeader>
					<CardTitle className="text-sm">By tax category</CardTitle>
				</CardHeader>
				<CardContent className="overflow-x-auto">
					<Table>
						<caption className="sr-only">Tax charged per tax category</caption>
						<TableHeader>
							<TableRow>
								<TableHead scope="col">Category</TableHead>
								<TableHead scope="col" className="text-right">
									Base
								</TableHead>
								<TableHead scope="col" className="text-right">
									VAT
								</TableHead>
								<TableHead scope="col" className="text-right">
									NHIL
								</TableHead>
								<TableHead scope="col" className="text-right">
									GETFund
								</TableHead>
								<TableHead scope="col" className="text-right">
									Tax
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{data.byCategory.map((row) => (
								<TableRow key={row.category}>
									<TableCell>{row.category.replaceAll("_", " ").toLowerCase()}</TableCell>
									<TableCell className="text-right font-mono tabular-nums">
										{formatGhs(row.baseMinor)}
									</TableCell>
									<TableCell className="text-right font-mono tabular-nums">
										{formatGhs(row.vatMinor)}
									</TableCell>
									<TableCell className="text-right font-mono tabular-nums">
										{formatGhs(row.nhilMinor)}
									</TableCell>
									<TableCell className="text-right font-mono tabular-nums">
										{formatGhs(row.getfundMinor)}
									</TableCell>
									<TableCell className="text-right font-mono tabular-nums">
										{formatGhs(row.totalMinor)}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</CardContent>
			</Card>

			{data.byBranch.length > 0 ? (
				<Card>
					<CardHeader>
						<CardTitle className="text-sm">By branch</CardTitle>
					</CardHeader>
					<CardContent className="overflow-x-auto">
						<Table>
							<caption className="sr-only">Tax charged per branch</caption>
							<TableHeader>
								<TableRow>
									<TableHead scope="col">Branch</TableHead>
									<TableHead scope="col" className="text-right">
										Base
									</TableHead>
									<TableHead scope="col" className="text-right">
										VAT
									</TableHead>
									<TableHead scope="col" className="text-right">
										NHIL
									</TableHead>
									<TableHead scope="col" className="text-right">
										GETFund
									</TableHead>
									<TableHead scope="col" className="text-right">
										Total
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
											{formatGhs(row.baseMinor)}
										</TableCell>
										<TableCell className="text-right font-mono tabular-nums">
											{formatGhs(row.vatMinor)}
										</TableCell>
										<TableCell className="text-right font-mono tabular-nums">
											{formatGhs(row.nhilMinor)}
										</TableCell>
										<TableCell className="text-right font-mono tabular-nums">
											{formatGhs(row.getfundMinor)}
										</TableCell>
										<TableCell className="text-right font-mono tabular-nums">
											{formatGhs(row.totalMinor)}
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
