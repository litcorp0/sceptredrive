import { formatBasisPoints, formatCount, formatDay } from "@sceptre/shared"
import { formatGhs } from "#/lib/format"
import type { SupplierPerformanceExclusions, SupplierPerformanceRow } from "../types"
import { formatLeadDays } from "../utils/suggestion"

function Figure({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div>
			<dt className="text-xs font-medium tracking-[0.04em] text-muted-foreground uppercase">
				{label}
			</dt>
			<dd className="mt-1 text-sm">{children}</dd>
		</div>
	)
}

/**
 * The evidence behind one supplier's headline numbers.
 *
 * Every count is printed so the rate can be checked by hand, the lead times are the API's tenths
 * divided by ten for display, and the exclusions are named rather than hidden in the denominator.
 */
export function PerformanceRowDetail({
	row,
	exclusions,
}: {
	row: SupplierPerformanceRow
	exclusions: SupplierPerformanceExclusions
}) {
	const onTimeDenominator = row.onTimeLines + row.lateLines

	return (
		<div className="grid gap-6 rounded-md bg-muted/30 p-4">
			<dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				<Figure label="On-time rate">
					<p>
						{formatCount(row.onTimeLines)} on time ÷ ({formatCount(row.onTimeLines)} +{" "}
						{formatCount(row.lateLines)} late) ={" "}
						{row.onTimeRateBasisPoints === null
							? "Not enough history yet"
							: formatBasisPoints(row.onTimeRateBasisPoints)}
					</p>
					<p className="mt-1 text-xs text-muted-foreground">
						{onTimeDenominator === 0
							? "No line has both a promised date and a first receipt, so there is no denominator."
							: "Only lines with both a promised date and a first receipt are in this denominator."}
					</p>
				</Figure>

				<Figure label="Fill rate">
					<p>
						{formatCount(row.receivedUnits)} received ÷ {formatCount(row.orderedUnits)} ordered ={" "}
						{row.fillRateBasisPoints === null
							? "Not enough history yet"
							: formatBasisPoints(row.fillRateBasisPoints)}
					</p>
					<p className="mt-1 text-xs text-muted-foreground">
						Capped at 100%, so an over-delivery cannot hide a short line.
					</p>
				</Figure>

				<Figure label="Lead time">
					<p>
						Promised {formatLeadDays(row.promisedLeadDaysAverageTenths)} · Actual{" "}
						{formatLeadDays(row.actualLeadDaysAverageTenths)}
					</p>
					<p className="mt-1 text-xs text-muted-foreground">
						Both are measured from the order's send date; early counts as on time.
					</p>
				</Figure>

				<Figure label="Last-cost drift">
					{row.lastCostDriftMinor === null ? (
						<p>
							No product has two receipts from this supplier yet, so there is no drift to compare.
						</p>
					) : (
						<>
							<p>
								{formatGhs(row.lastCostDriftMinor)} (
								{formatBasisPoints(row.lastCostDriftBasisPoints)}) across{" "}
								{formatCount(row.driftComparableProducts)} products with two or more receipts.
							</p>
							<p className="mt-1 text-xs text-muted-foreground">
								Positive means the latest receipt cost more than the one before it.
							</p>
						</>
					)}
				</Figure>

				<Figure label="Last delivery">
					<p>
						{row.lastCostAt ? formatDay(row.lastCostAt) : "No delivery from this supplier yet."}
					</p>
					<p className="mt-1 text-xs text-muted-foreground">
						The most recent goods receipt from this supplier at this branch.
					</p>
				</Figure>

				<Figure label="Orders measured">
					<p>
						{formatCount(row.ordersCount)} orders · {formatCount(row.linesCount)} lines
					</p>
					<p className="mt-1 text-xs text-muted-foreground">
						Every figure on this row is measured per purchase-order line in the selected period.
					</p>
				</Figure>
			</dl>

			<section>
				<h3 className="text-sm font-medium">What the rates exclude</h3>
				<ul className="mt-2 grid gap-2 text-sm text-muted-foreground">
					<li>
						{formatCount(row.noPromiseLines)} lines had no promised date. They are excluded from the
						on-time rate because there is nothing to be late against.
					</li>
					<li>
						{formatCount(row.noReceiptLines)} promised lines have no receipt yet. They are excluded
						from the on-time rate because nothing has arrived to compare with the promise.
					</li>
					<li>
						{formatCount(exclusions.ordersWithoutSendDate)} orders have no send date, so their lead
						time cannot be measured.
					</li>
					<li>
						{formatCount(exclusions.linesWithoutReceipt)} lines across all suppliers have no receipt
						yet, so the fill rate cannot count them.
					</li>
				</ul>
			</section>
		</div>
	)
}
