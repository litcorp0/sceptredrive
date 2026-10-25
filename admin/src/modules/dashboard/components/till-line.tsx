import { formatCount } from "@sceptre/shared"
import { formatGhs } from "#/lib/format"
import type { OverviewResponse } from "#/modules/analytics"

/**
 * The Till Line: what the business took, and how it arrived.
 *
 * The dominant figure is the take. Underneath, the server's tender split is shown as labelled
 * sub-figures — never recomputed here. Cash is already derived server-side as
 * take − electronic − credit, because a CASH tender row contains the change handed back.
 */
export function TillLine({ totals }: { totals: OverviewResponse["totals"] }) {
	const slices = [
		{ label: "Cash", value: totals.cashMinor },
		{ label: "Electronic", value: totals.electronicMinor },
		{ label: "Credit", value: totals.creditMinor },
	]
	const methods = slices.filter((slice) => slice.value > 0)

	return (
		<section aria-labelledby="till-line-heading" className="rounded-xl border bg-card p-5">
			<h2
				id="till-line-heading"
				className="text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase"
			>
				Takings
			</h2>
			<div className="mt-1 flex flex-wrap items-end gap-x-4 gap-y-1">
				<p className="font-display text-4xl leading-none tabular-nums" data-money>
					{formatGhs(totals.takeMinor)}
				</p>
				<p className="text-sm text-muted-foreground">
					{formatCount(totals.salesCount)} sales · {formatCount(totals.itemsSold)} items ·{" "}
					{formatGhs(totals.avgBasketMinor)} average basket
				</p>
			</div>

			<dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
				{methods.map((slice) => (
					<div key={slice.label}>
						<dt className="text-xs text-muted-foreground">{slice.label}</dt>
						<dd className="font-mono text-lg tabular-nums">{formatGhs(slice.value)}</dd>
					</div>
				))}
				<div>
					<dt className="text-xs text-muted-foreground">Tax collected</dt>
					<dd className="font-mono text-lg tabular-nums">{formatGhs(totals.tax.totalMinor)}</dd>
				</div>
				<div>
					<dt className="text-xs text-muted-foreground">Change given</dt>
					<dd className="font-mono text-lg tabular-nums">{formatGhs(totals.changeMinor)}</dd>
				</div>
			</dl>
		</section>
	)
}
