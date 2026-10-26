import { formatCount } from "@sceptre/shared"
import { Link } from "@tanstack/react-router"
import { StatusBadge } from "#/components/common/status-badge"
import type { ReplenishmentRow } from "../types"
import { formatBasis, reasonSentence } from "../utils/suggestion"

/**
 * The full input list behind one suggestion.
 *
 * Every figure is printed from the API response, including the settings echo; the only arithmetic
 * on screen is the coverage addition and the target − position subtraction the manager is checking
 * by hand. No quantity is recalculated.
 */
export function SuggestionBasis({
	row,
	safetyDays,
}: {
	row: ReplenishmentRow
	safetyDays: number
}) {
	const coverDays = row.leadTimeDays + safetyDays
	const targetSource =
		row.maxLevel !== null && row.maxLevel >= row.coverageLevel
			? "the stored maximum"
			: "the sales cover"

	return (
		<div className="grid gap-3 text-sm">
			<p>
				{formatCount(row.unitsSold)} sold in the last {formatCount(row.velocityDays)} days.
			</p>
			<p>
				Lead time {formatCount(row.leadTimeDays)} days + safety {formatCount(safetyDays)} days ={" "}
				{formatCount(coverDays)} days of cover → {formatCount(row.coverageLevel)} units.
			</p>
			<p>
				Stored maximum {row.maxLevel === null ? "not set" : formatCount(row.maxLevel)} → target{" "}
				{formatCount(row.targetLevel)} units, set by {targetSource}.
			</p>
			<p>
				Reorder point {formatCount(row.minLevel)} units · minimum order{" "}
				{formatCount(row.minOrderQuantity)} units.
			</p>
			<p>
				On hand {formatCount(row.onHand)} + on order {formatCount(row.onOrder)} = position{" "}
				{formatCount(row.position)}.
			</p>
			<p>
				Suggested = clamp(target {formatCount(row.targetLevel)} − position{" "}
				{formatCount(row.position)}, 0, {formatCount(row.targetLevel)})
				{row.minOrderQuantity > 0
					? `, at least the supplier minimum of ${formatCount(row.minOrderQuantity)}`
					: ""}{" "}
				= {formatCount(row.suggested)}.
			</p>
			<p className="text-muted-foreground">
				Basis: {formatBasis(row.basis)}. {reasonSentence(row)}
			</p>

			{row.leadTimeAssumed ? (
				<div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
					<StatusBadge variant="warn">Lead time assumed</StatusBadge>
					<p className="text-sm">
						Supplier lead time not set — {formatCount(row.leadTimeDays)} days assumed.
					</p>
					{row.supplierId ? (
						<Link
							to="/suppliers/$supplierId"
							params={{ supplierId: row.supplierId }}
							className="text-sm font-medium text-primary hover:underline"
						>
							Set the lead time
						</Link>
					) : null}
				</div>
			) : null}
		</div>
	)
}
