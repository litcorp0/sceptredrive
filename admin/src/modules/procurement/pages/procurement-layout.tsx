import { Outlet } from "@tanstack/react-router"
import { PageHeader } from "#/components/common/page-header"
import { Tabs, TabsList, TabsTrigger } from "#/components/ui/tabs"

/**
 * The procurement section shell: header, tabs and the page outlet.
 *
 * Replenishment and supplier performance are Plan 10's screens; their tabs and routes are added
 * with those pages, because a tab that navigates to a route that does not exist cannot typecheck.
 */
export function ProcurementLayout() {
	return (
		<div className="mx-auto max-w-6xl">
			<PageHeader
				title="Procurement"
				description="Purchase orders, receiving, supplier returns and the decisions that gate them."
			/>

			<Tabs value="orders">
				<TabsList>
					<TabsTrigger value="orders">Orders</TabsTrigger>
				</TabsList>
			</Tabs>

			<div className="mt-4">
				<Outlet />
			</div>
		</div>
	)
}
