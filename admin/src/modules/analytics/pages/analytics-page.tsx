import { getRouteApi } from "@tanstack/react-router"
import type { ComponentType } from "react"
import { PageHeader } from "#/components/common/page-header"
import { useBranch } from "#/lib/branch-context"
import { FilterBar } from "../components/filter-bar"
import { TabNav } from "../components/tab-nav"
import { useAnalyticsBranch } from "../hooks/use-analytics-filters"
import type { AnalyticsTab } from "../types"
import { ANALYTICS_TABS } from "../utils/search"
import { CreditTab } from "./tabs/credit-tab"
import { InventoryTab } from "./tabs/inventory-tab"
import { LoyaltyTab } from "./tabs/loyalty-tab"
import { PayablesTab } from "./tabs/payables-tab"
import { ProductsTab } from "./tabs/products-tab"
import { SalesTab } from "./tabs/sales-tab"
import { TaxTab } from "./tabs/tax-tab"

const routeApi = getRouteApi("/_authenticated/analytics")

const TAB_COMPONENTS: Record<AnalyticsTab, ComponentType> = {
	sales: SalesTab,
	products: ProductsTab,
	inventory: InventoryTab,
	credit: CreditTab,
	loyalty: LoyaltyTab,
	payables: PayablesTab,
	tax: TaxTab,
}

/**
 * The analytics drill-down.
 *
 * The page owns nothing but composition: period, branch, granularity, tab, and sort all live
 * in the search params, and each tab fetches exactly one report. Nothing here aggregates a
 * list or does arithmetic on money.
 */
export function AnalyticsPage() {
	const search = routeApi.useSearch()
	const navigate = routeApi.useNavigate()
	const { activeBranch, canSelectBranch } = useBranch()
	const { branchId } = useAnalyticsBranch(search.branchId)
	const activeTab: AnalyticsTab =
		search.tab && (ANALYTICS_TABS as readonly string[]).includes(search.tab)
			? (search.tab as AnalyticsTab)
			: "sales"
	const Tab = TAB_COMPONENTS[activeTab]

	const branchLabel = canSelectBranch
		? branchId
			? (activeBranch?.code ?? "Selected branch")
			: "All branches"
		: (activeBranch?.name ?? "Your branch")

	return (
		<div className="grid gap-5">
			<PageHeader
				eyebrow="Insight"
				title="Analytics"
				description="Every figure is a server aggregate over the ledgers, reconciled per period and branch. Period, branch, and grouping live in the URL, so a view can be shared."
			/>
			<FilterBar
				search={search}
				branchLabel={branchLabel}
				onChange={(patch) => {
					void navigate({ search: (prev: Record<string, unknown>) => ({ ...prev, ...patch }) })
				}}
			/>
			<TabNav active={activeTab} />
			<Tab />
		</div>
	)
}
