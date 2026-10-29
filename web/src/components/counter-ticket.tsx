import type { PartFamily } from "#/lib/parts"

/**
 * The signature artifact: a till ticket, not a stock-photo card. It carries the
 * parts index in the shape a counter actually hands you — mono codes, a branch
 * stamp, a barcode strip and a punched edge. The print-in animation is the one
 * orchestrated moment on the page.
 */
export function CounterTicket({
	families,
	branchName,
}: {
	families: PartFamily[]
	branchName?: string
}) {
	return (
		<aside
			aria-label="Counter ticket preview"
			className="site-print relative w-full max-w-sm border border-line bg-surface shadow-pop md:rotate-[0.6deg]"
		>
			<div className="ticket-perf -mt-px" aria-hidden="true" />
			<div className="p-6">
				<div className="flex items-baseline justify-between gap-4">
					<p className="eyebrow">Counter ticket</p>
					<p className="font-mono text-[11px] text-muted-ink">{branchName ?? "Parts desk"}</p>
				</div>

				<div className="mt-5 flex items-end justify-between gap-4">
					<p className="font-mono text-[11px] tracking-[0.14em] text-muted-ink uppercase">
						No. 001 · Parts range
					</p>
				</div>

				<h2 className="mt-1 font-display text-2xl font-semibold tracking-tight">Parts index</h2>

				<ul className="mt-5 border-y border-dashed border-line-strong/60">
					{families.map((family) => (
						<li
							key={family.slug}
							className="flex items-baseline gap-3 border-b border-dashed border-line py-2 last:border-b-0"
						>
							<span className="font-mono text-[11px] text-muted-ink">{family.code}</span>
							<span className="flex-1 truncate text-sm">{family.name}</span>
							<span className="font-mono text-[11px] text-muted-ink">
								{String(family.examples.length).padStart(2, "0")}
							</span>
						</li>
					))}
				</ul>

				<div className="ticket-barcode mt-5" aria-hidden="true" />

				<div className="mt-3 flex items-center justify-between gap-4 font-mono text-[10px] tracking-[0.12em] text-muted-ink uppercase">
					<span>No online sales</span>
					<span>Counter copy</span>
				</div>
			</div>
		</aside>
	)
}
