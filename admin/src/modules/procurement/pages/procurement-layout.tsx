import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router"
import { PageHeader } from "#/components/common/page-header"
import { Tabs, TabsList, TabsTrigger } from "#/components/ui/tabs"

const TAB_LINKS = {
	orders: "/procurement/orders",
	replenishment: "/procurement/replenishment",
	suppliers: "/procurement/suppliers",
} as const

type ProcurementTab = keyof typeof TAB_LINKS

/**
 * The procurement section shell: header, tabs and the page outlet.
 *
 * Replenishment and supplier performance live under `/procurement` even though their pages belong
 * to the `replenishment` module: a route path is not a module owner. The tab value follows the
 * pathname so a deep link to either screen keeps its tab selected.
 */
export function ProcurementLayout() {
	const navigate = useNavigate()
	const pathname = useRouterState({ select: (state) => state.location.pathname })

	const active: ProcurementTab =
		(Object.keys(TAB_LINKS) as ProcurementTab[]).find((tab) =>
			pathname.startsWith(TAB_LINKS[tab]),
		) ?? "orders"

	return (
		<div className="mx-auto max-w-6xl">
			<PageHeader
				title="Procurement"
				description="Purchase orders, receiving, supplier returns and the decisions that gate them."
			/>

			<Tabs
				value={active}
				onValueChange={(value) => void navigate({ to: TAB_LINKS[value as ProcurementTab] })}
			>
				<TabsList>
					<TabsTrigger value="orders">Orders</TabsTrigger>
					<TabsTrigger value="replenishment">Replenishment</TabsTrigger>
					<TabsTrigger value="suppliers">Suppliers</TabsTrigger>
				</TabsList>
			</Tabs>

			<div className="mt-4">
				<Outlet />
			</div>
		</div>
	)
}
