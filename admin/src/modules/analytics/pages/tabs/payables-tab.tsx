import { formatBucket } from "@sceptre/shared"
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
import type { PayablesResponse } from "../../types"
import { cedisTick, moneyTooltip } from "../../utils/format-chart"
import { toAnalyticsQuery } from "../../utils/search"

const routeApi = getRouteApi("/_authenticated/analytics")

const flowConfig = {
	invoiced: { label: "Invoiced", color: "var(--chart-1)" },
	paid: { label: "Paid", color: "var(--chart-2)" },
} satisfies ChartConfig

const bucketsConfig = {
	amount: { label: "Overdue", color: "var(--chart-1)" },
} satisfies ChartConfig

const BUCKET_LABELS: Array<[keyof PayablesResponse["overdueBuckets"], string]> = [
	["current", "Not yet due"],
	["days1To30", "1–30 days"],
	["days31To60", "31–60 days"],
	["days61To90", "61–90 days"],
	["over90", "Over 90 days"],
]

/**
 * What the business owes, not which supplier to pay first — the payable ageing screen owns
 * the per-supplier working list. Buckets come from the payables service so the boundaries can
 * never differ between the two screens.
 */
export function PayablesTab() {
	const search = routeApi.useSearch()
	const { branchId } = useAnalyticsBranch(search.branchId)
	const query = toAnalyticsQuery(search, branchId)
	const report = useQuery(analyticsReportOptions<PayablesResponse>("payables", query))

	if (report.isLoading) return <PanelState state="loading" label="Payables report" rows={6} />
	if (report.isError) {
		return (
			<PanelState
				state="error"
				label="Payables report"
				message={report.error instanceof ApiError ? report.error.message : undefined}
				onRetry={() => void report.refetch()}
			/>
		)
	}

	const data = report.data
	if (!data) return null

	const flow = data.series.map((point) => ({
		bucket: formatBucket(point.bucketStart, search.granularity ?? "day"),
		invoiced: point.invoicedMinor,
		paid: point.paidMinor,
	}))
	const buckets = BUCKET_LABELS.map(([key, label]) => ({
		label,
		amount: data.overdueBuckets[key],
	}))

	return (
		<div className="grid gap-5">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<p className="text-sm text-muted-foreground">
					{formatGhs(data.totals.invoicedMinor)} invoiced · {formatGhs(data.totals.paidMinor)} paid
					· {formatGhs(data.totals.onAccountMinor)} on account
				</p>
				<ExportButton report="payables" query={query} label="Payables" />
			</div>

			<KpiRow>
				<KpiTile label="Outstanding" value={formatGhs(data.totals.outstandingMinor)} />
				<KpiTile label="Paid in period" value={formatGhs(data.totals.paidMinor)} />
				<KpiTile
					label="Overdue"
					value={formatGhs(data.totals.overdueMinor)}
					detail="Past its due date and still open"
				/>
				<KpiTile label="On account" value={formatGhs(data.totals.onAccountMinor)} />
			</KpiRow>

			<ChartCard
				title="Invoiced against paid"
				description="Supplier invoices raised and payments made per bucket, in GHS."
				summary={`${formatGhs(data.totals.invoicedMinor)} was invoiced and ${formatGhs(data.totals.paidMinor)} paid in this period.`}
				table={{
					caption: "Supplier invoices and payments per bucket",
					columns: [
						{ key: "bucket", label: "Period" },
						{ key: "invoiced", label: "Invoiced", align: "right" },
						{ key: "paid", label: "Paid", align: "right" },
					],
					rows: flow.map((point) => ({
						bucket: point.bucket,
						invoiced: formatGhs(point.invoiced),
						paid: formatGhs(point.paid),
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
							dataKey="invoiced"
							type="monotone"
							fill="var(--color-invoiced)"
							fillOpacity={0.18}
							stroke="var(--color-invoiced)"
							strokeWidth={2}
						/>
						<Area
							dataKey="paid"
							type="monotone"
							fill="var(--color-paid)"
							fillOpacity={0.12}
							stroke="var(--color-paid)"
							strokeWidth={2}
						/>
					</AreaChart>
				</ChartContainer>
			</ChartCard>

			<ChartCard
				title="Outstanding by age"
				description="Open invoice balances by days past due, in GHS."
				summary={`${formatGhs(data.totals.overdueMinor)} is past due, of which ${formatGhs(data.overdueBuckets.over90)} is more than 90 days old.`}
				table={{
					caption: "Outstanding supplier balance by age",
					columns: [
						{ key: "label", label: "Age" },
						{ key: "amount", label: "Balance", align: "right" },
					],
					rows: buckets.map((row) => ({
						label: row.label,
						amount: formatGhs(row.amount),
					})),
				}}
			>
				<ChartContainer config={bucketsConfig} className="h-56 w-full">
					<BarChart data={buckets} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
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

			<Card>
				<CardHeader>
					<CardTitle className="text-sm">Suppliers owed the most</CardTitle>
				</CardHeader>
				<CardContent>
					{data.topSuppliers.length === 0 ? (
						<p className="text-sm text-muted-foreground">Nothing outstanding in this scope.</p>
					) : (
						<Table>
							<caption className="sr-only">Suppliers with the largest outstanding balance</caption>
							<TableHeader>
								<TableRow>
									<TableHead scope="col">Supplier</TableHead>
									<TableHead scope="col" className="text-right">
										Outstanding
									</TableHead>
									<TableHead scope="col" className="text-right">
										Overdue
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{data.topSuppliers.map((row) => (
									<TableRow key={row.supplierId}>
										<TableCell>
											{row.code} · {row.name}
										</TableCell>
										<TableCell className="text-right font-mono tabular-nums">
											{formatGhs(row.outstandingMinor)}
										</TableCell>
										<TableCell className="text-right font-mono tabular-nums">
											{formatGhs(row.overdueMinor)}
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
