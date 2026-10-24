/**
 * One headline figure. Presentational: label, value and detail are all strings supplied by the
 * page, which is what keeps Phase 9's rewrite able to replace the numbers without touching this.
 */
export function StatCard({
	label,
	value,
	detail,
}: {
	label: string
	value: string
	detail: string
}) {
	return (
		<div className="rounded-lg border bg-card p-4">
			<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
			<p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
			<p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
		</div>
	)
}
