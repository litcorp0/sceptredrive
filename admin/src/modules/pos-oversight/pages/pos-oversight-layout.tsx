import { getRouteApi, Link, Outlet, useRouterState, useSearch } from "@tanstack/react-router"
import { cn } from "cn"
import { PageHeader } from "#/components/common/page-header"
import { hasPermission } from "#/lib/role"
import { POS_TABS, type PosTab, resolveTab } from "../utils/search"

const authenticatedRoute = getRouteApi("/_authenticated")

const TAB_LABELS: Record<PosTab, string> = {
	sales: "Sales",
	refunds: "Refunds",
	shifts: "Shifts",
	conflicts: "Conflicts",
}

/**
 * The section shell for `/pos`: one heading, four document tabs, and the tab's outlet.
 *
 * The tab lives in the URL (`?tab=conflicts`) so a link from the dashboard's conflict
 * tile opens the queue. A tab a role cannot read is not rendered: the API is the real
 * gate, and a dead tab is a promise the console cannot keep.
 */
export function PosOversightLayout() {
	const { session } = authenticatedRoute.useRouteContext()
	const pathname = useRouterState({ select: (state) => state.location.pathname })
	const search = useSearch({ strict: false }) as { tab?: PosTab }
	const canReadConflicts = hasPermission(session.user.role, "conflict.read")

	const tabs = POS_TABS.filter((tab) => tab !== "conflicts" || canReadConflicts)
	const active: PosTab = pathname.startsWith("/pos/sales")
		? "sales"
		: pathname.startsWith("/pos/refunds")
			? "refunds"
			: pathname.startsWith("/pos/shifts")
				? "shifts"
				: resolveTab(search.tab)

	return (
		<div className="grid gap-4">
			<div className="print:hidden">
				<PageHeader
					eyebrow="Operations"
					title="POS oversight"
					description="Every document a terminal produced, and the conflict queue it raised. These screens read; a conflict resolution records a decision and changes no sale, stock or ledger."
				/>
			</div>

			<nav aria-label="POS oversight sections" className="print:hidden">
				<ul className="flex flex-wrap items-center gap-1 border-b">
					{tabs.map((tab) => (
						<li key={tab}>
							<Link
								to="/pos"
								search={{ tab }}
								aria-current={active === tab ? "page" : undefined}
								className={cn(
									"-mb-px inline-flex items-center border-b-2 px-3 py-2 text-sm font-medium",
									active === tab
										? "border-brand text-foreground"
										: "border-transparent text-muted-foreground hover:text-foreground",
								)}
							>
								{TAB_LABELS[tab]}
							</Link>
						</li>
					))}
				</ul>
			</nav>

			<Outlet />
		</div>
	)
}
