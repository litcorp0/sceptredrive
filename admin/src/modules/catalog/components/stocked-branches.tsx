import type { Product } from "../types"

/** How many branch names fit in the cell before the rest collapse into a count. */
const VISIBLE = 2

/**
 * Which branches carry a product, and how much of it each holds (P20-D17).
 *
 * "Carries" is a stock level at the branch — the same fact the stock list, the till and the
 * replenishment screen use — so the column cannot claim a branch stocks something the
 * branch's own list denies. A manager's rows arrive already scoped to their branch, so this
 * renders one name for them and the whole company for an administrator.
 *
 * The names are the information; the quantity is a second line of the same fact, not a
 * number to add up here. Overflow collapses into "+N" with the full list in the title, so a
 * shop with eight branches does not turn one cell into a paragraph.
 */
export function StockedBranches({ branches }: { branches: Product["stockedAt"] }) {
	if (branches.length === 0) {
		return <span className="italic">Not stocked anywhere</span>
	}

	const shown = branches.slice(0, VISIBLE)
	const hidden = branches.length - shown.length
	const summary = branches
		.map((branch) => `${branch.branchName} · ${branch.quantityOnHand} on hand`)
		.join("\n")

	return (
		<span
			className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5"
			title={summary}
			data-testid="stocked-branches"
		>
			{shown.map((branch, index) => (
				<span key={branch.branchId} className="whitespace-nowrap">
					{index > 0 ? <span aria-hidden="true">· </span> : null}
					{branch.branchName}
					<span className="ml-1 text-[11px] tabular-nums opacity-70">{branch.quantityOnHand}</span>
				</span>
			))}
			{hidden > 0 ? (
				<span className="whitespace-nowrap text-[11px] opacity-70">+{hidden} more</span>
			) : null}
			<span className="sr-only">On hand by branch: {summary.replaceAll("\n", ", ")}</span>
		</span>
	)
}
