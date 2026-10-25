import { formatCount } from "@sceptre/shared"
import { Link } from "@tanstack/react-router"
import { AlertTriangle, CircleDot, Clock, PackageX, ShieldAlert, Ticket } from "lucide-react"
import type { OverviewResponse } from "#/modules/analytics"

interface AttentionItem {
	id: string
	label: string
	count: number
	detail: string
	icon: typeof Clock
	tone: "warn" | "danger" | "info"
	/** An existing screen where the reader can act; omitted when none exists yet. */
	to?: "/inventory/stock" | "/customers/aging" | "/loyalty" | "/terminals" | "/audit"
}

/**
 * What needs a human, in one strip.
 *
 * Counts come from the overview payload; nothing is estimated. Items link only to screens
 * that exist today — a link that goes nowhere is worse than a labelled count.
 */
export function NeedsAttention({ attention }: { attention: OverviewResponse["attention"] }) {
	const items = [
		{
			id: "low-stock",
			label: "Below threshold",
			count: attention.lowStockCount,
			detail: "Products at or under their minimum",
			icon: PackageX,
			tone: "warn" as const,
			to: "/inventory/stock" as const,
		},
		{
			id: "over-limit",
			label: "Credit over limit",
			count: attention.overLimitCreditCount,
			detail: "Customers above their agreed limit",
			icon: AlertTriangle,
			tone: "danger" as const,
			to: "/customers/aging" as const,
		},
		{
			id: "expiring",
			label: "Points expiring",
			count: attention.expiringPoints,
			detail: "Within 30 days",
			icon: Ticket,
			tone: "info" as const,
			to: "/loyalty" as const,
		},
		{
			id: "open-shifts",
			label: "Open shifts",
			count: attention.openShiftCount,
			detail: "Not yet closed at a terminal",
			icon: Clock,
			tone: "info" as const,
			to: "/terminals" as const,
		},
		{
			id: "conflicts",
			label: "Sync conflicts",
			count: attention.openConflictCount,
			detail: attention.conflictsBySeverity.high
				? `${attention.conflictsBySeverity.high} high severity`
				: "Awaiting review",
			icon: ShieldAlert,
			tone: attention.conflictsBySeverity.high > 0 ? ("danger" as const) : ("warn" as const),
			to: "/audit" as const,
		},
	] satisfies AttentionItem[]

	const visible = items.filter((item) => item.count > 0)

	if (visible.length === 0) {
		return (
			<section className="flex items-center gap-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
				<CircleDot aria-hidden="true" className="size-4" />
				Nothing needs attention in this period.
			</section>
		)
	}

	return (
		<section aria-labelledby="attention-heading" className="grid gap-2">
			<h2 id="attention-heading" className="text-sm font-semibold tracking-tight">
				Needs attention
			</h2>
			<ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
				{visible.map((item) => {
					const Icon = item.icon
					const body = (
						<>
							<Icon
								aria-hidden="true"
								className={
									item.tone === "danger"
										? "size-4 text-danger"
										: item.tone === "warn"
											? "size-4 text-warn"
											: "size-4 text-info"
								}
							/>
							<span className="min-w-0">
								<span className="block text-sm font-medium">
									{formatCount(item.count)} {item.label.toLowerCase()}
								</span>
								<span className="block text-xs text-muted-foreground">{item.detail}</span>
							</span>
						</>
					)
					return (
						<li key={item.id}>
							{item.to ? (
								<Link
									to={item.to}
									className="flex items-start gap-3 rounded-lg border bg-card p-3 hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
								>
									{body}
								</Link>
							) : (
								<div className="flex items-start gap-3 rounded-lg border bg-card p-3">{body}</div>
							)}
						</li>
					)
				})}
			</ul>
		</section>
	)
}
