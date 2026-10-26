/**
 * A labelled figure with one sentence under it.
 *
 * The value is already formatted by the caller (`formatGhs`, `formatBasisPoints`, `formatCount`),
 * so this component never divides money or invents a rate.
 */
export function MetricTile({
	label,
	value,
	explanation,
}: {
	label: string
	value: string
	/** One sentence saying what the figure counts or measures. */
	explanation: string
}) {
	return (
		<div className="rounded-md border bg-card p-4">
			<p className="text-xs font-medium tracking-[0.04em] text-muted-foreground uppercase">
				{label}
			</p>
			<p className="mt-1 font-display text-2xl tabular-nums">{value}</p>
			<p className="mt-2 text-xs text-muted-foreground">{explanation}</p>
		</div>
	)
}
