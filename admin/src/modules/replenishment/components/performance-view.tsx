import { formatBasisPoints, formatCount, formatDay, formatRange } from "@sceptre/shared"
import { Link } from "@tanstack/react-router"
import { cn } from "cn"
import { ChevronRightIcon } from "lucide-react"
import { Fragment, useState } from "react"
import { TableMessage } from "#/components/common/table-message"
import { Button } from "#/components/ui/button"
import { Label } from "#/components/ui/label"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table"
import { formatGhs } from "#/lib/format"
import type { SupplierPerformanceResult } from "../types"
import { MetricTile } from "../ui/metric-tile"
import { formatLeadDays } from "../utils/suggestion"
import { PerformanceRowDetail } from "./performance-row-detail"

export type PerformancePeriod = 30 | 90 | 365

const PERIODS: { value: PerformancePeriod; label: string }[] = [
	{ value: 30, label: "Last 30 days" },
	{ value: 90, label: "Last 90 days" },
	{ value: 365, label: "Last 365 days" },
]

function rate(value: number | null): string {
	return value === null ? "Not enough history yet" : formatBasisPoints(value)
}

/**
 * The supplier scorecard.
 *
 * The period is the only control; the branch comes from the shell and the API scopes every row.
 * A rate is printed only when it has a denominator, and the expansion prints that denominator,
 * the lead-time tenths and every exclusion so the figure is checkable by hand.
 */
export function PerformanceView({
	data,
	isLoading,
	isError,
	periodDays,
	onPeriodChange,
	from,
	to,
}: {
	data: SupplierPerformanceResult | null
	isLoading: boolean
	isError: boolean
	periodDays: PerformancePeriod
	onPeriodChange: (period: PerformancePeriod) => void
	from: string
	to: string
}) {
	const [expanded, setExpanded] = useState<Set<string>>(new Set())
	const columns = 7

	function toggleSupplier(supplierId: string) {
		setExpanded((current) => {
			const next = new Set(current)
			if (next.has(supplierId)) next.delete(supplierId)
			else next.add(supplierId)
			return next
		})
	}

	return (
		<div className="grid gap-4">
			<p className="text-sm text-muted-foreground">
				On time means the first delivery arrived on or before the promised date; early counts as on
				time. Fill rate is what arrived ÷ what was ordered, capped at 100%.
			</p>

			<div className="flex flex-wrap items-end justify-between gap-3">
				<div className="grid gap-1.5">
					<Label htmlFor="performance-period">Period</Label>
					<Select
						value={String(periodDays)}
						onValueChange={(value) => onPeriodChange(Number(value) as PerformancePeriod)}
					>
						<SelectTrigger id="performance-period" className="w-48">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{PERIODS.map((period) => (
								<SelectItem key={period.value} value={String(period.value)}>
									{period.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<p className="pb-2 text-sm text-muted-foreground">{formatRange(from, to)}</p>
			</div>

			{data ? (
				<div className="grid gap-3 sm:grid-cols-3">
					<MetricTile
						label="Suppliers measured"
						value={formatCount(data.totals.suppliers)}
						explanation="Suppliers with at least one purchase-order line in this period."
					/>
					<MetricTile
						label="On-time rate"
						value={rate(data.totals.onTimeRateBasisPoints)}
						explanation="The share of measurable lines that arrived on or before the promised date."
					/>
					<MetricTile
						label="Fill rate"
						value={rate(data.totals.fillRateBasisPoints)}
						explanation="Received units ÷ ordered units on orders that have received, capped at 100%."
					/>
				</div>
			) : null}

			<div className="rounded-md border">
				<Table>
					<caption className="sr-only">Supplier performance for the selected period</caption>
					<TableHeader>
						<TableRow>
							<TableHead>Supplier</TableHead>
							<TableHead className="text-right">Orders</TableHead>
							<TableHead className="text-right">On time</TableHead>
							<TableHead className="text-right">Fill rate</TableHead>
							<TableHead className="text-right">Lead time promised → actual</TableHead>
							<TableHead className="text-right">Cost drift</TableHead>
							<TableHead className="text-right">Last delivery</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{isLoading ? (
							<TableMessage colSpan={columns} state="loading" rows={6}>
								Loading supplier performance…
							</TableMessage>
						) : isError || !data ? (
							<TableMessage colSpan={columns} tone="error">
								Couldn't load supplier performance.
							</TableMessage>
						) : data.suppliers.length === 0 ? (
							<TableMessage colSpan={columns}>No orders in this period.</TableMessage>
						) : (
							data.suppliers.map((row) => {
								const isExpanded = expanded.has(row.supplierId)
								return (
									<Fragment key={row.supplierId}>
										<TableRow>
											<TableCell>
												<div className="flex items-center gap-1.5">
													<Button
														type="button"
														variant="ghost"
														size="sm"
														className="size-7 px-0"
														aria-expanded={isExpanded}
														aria-controls={`performance-detail-${row.supplierId}`}
														aria-label={`Show the evidence behind ${row.supplierName}`}
														onClick={() => toggleSupplier(row.supplierId)}
													>
														<ChevronRightIcon
															className={cn(
																"size-4 transition-transform",
																isExpanded && "rotate-90",
															)}
															aria-hidden="true"
														/>
													</Button>
													<div className="min-w-0">
														<Link
															to="/suppliers/$supplierId"
															params={{ supplierId: row.supplierId }}
															className="block truncate font-medium hover:underline"
														>
															{row.supplierName}
														</Link>
														<p className="font-mono text-xs text-muted-foreground">
															{row.supplierCode}
														</p>
													</div>
												</div>
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{formatCount(row.ordersCount)}
												<span className="block text-xs text-muted-foreground">
													{formatCount(row.linesCount)} lines
												</span>
											</TableCell>
											<TableCell
												className={cn(
													"text-right tabular-nums",
													row.onTimeRateBasisPoints === null && "text-muted-foreground",
												)}
											>
												{rate(row.onTimeRateBasisPoints)}
											</TableCell>
											<TableCell
												className={cn(
													"text-right tabular-nums",
													row.fillRateBasisPoints === null && "text-muted-foreground",
												)}
											>
												{rate(row.fillRateBasisPoints)}
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{row.promisedLeadDaysAverageTenths === null &&
												row.actualLeadDaysAverageTenths === null ? (
													"—"
												) : (
													<>
														{formatLeadDays(row.promisedLeadDaysAverageTenths)}
														<span className="text-muted-foreground"> → </span>
														{formatLeadDays(row.actualLeadDaysAverageTenths)}
													</>
												)}
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{row.lastCostDriftMinor === null ? (
													"—"
												) : (
													<>
														{formatGhs(row.lastCostDriftMinor)}
														<span className="ml-1 text-xs text-muted-foreground">
															{formatBasisPoints(row.lastCostDriftBasisPoints)}
														</span>
													</>
												)}
											</TableCell>
											<TableCell className="text-right text-muted-foreground">
												{row.lastCostAt ? formatDay(row.lastCostAt) : "No delivery yet"}
											</TableCell>
										</TableRow>
										<TableRow
											key={`${row.supplierId}-detail`}
											id={`performance-detail-${row.supplierId}`}
											hidden={!isExpanded}
										>
											<TableCell colSpan={columns} className="p-0">
												{isExpanded && data ? (
													<PerformanceRowDetail row={row} exclusions={data.exclusions} />
												) : null}
											</TableCell>
										</TableRow>
									</Fragment>
								)
							})
						)}
					</TableBody>
				</Table>
			</div>
		</div>
	)
}
