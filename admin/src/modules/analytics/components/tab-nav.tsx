import { Link } from "@tanstack/react-router"
import { ANALYTICS_TABS } from "../utils/search"

export const TAB_LABELS: Record<(typeof ANALYTICS_TABS)[number], string> = {
	sales: "Sales",
	products: "Products",
	inventory: "Inventory",
	credit: "Credit",
	loyalty: "Loyalty",
	payables: "Payables",
	tax: "Tax",
}

/**
 * Tabs are links, not local state: the active tab is part of the URL, so it is bookmarkable,
 * middle-clickable, and operable by keyboard without a custom roving tabindex.
 */
export function TabNav({ active }: { active: string }) {
	return (
		<nav aria-label="Analytics sections" className="border-b">
			<ul className="-mb-px flex flex-wrap gap-1">
				{ANALYTICS_TABS.map((tab) => {
					const current = tab === active
					return (
						<li key={tab}>
							<Link
								to="/analytics"
								search={(prev) => ({ ...prev, tab, offset: undefined })}
								aria-current={current ? "page" : undefined}
								className={
									current
										? "inline-block border-b-2 border-brand px-3 py-2 text-sm font-medium text-foreground"
										: "inline-block border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
								}
							>
								{TAB_LABELS[tab]}
							</Link>
						</li>
					)
				})}
			</ul>
		</nav>
	)
}
