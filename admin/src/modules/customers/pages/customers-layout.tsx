import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router"
import { PageHeader } from "#/components/common/page-header"
import { Tabs, TabsList, TabsTrigger } from "#/components/ui/tabs"

const TAB_LINKS = {
	customers: "/customers",
	aging: "/customers/aging",
} as const

type CustomersTab = keyof typeof TAB_LINKS

/**
 * The customers section shell: header, the two tabs, and the tab's outlet.
 *
 * Section layout is page markup (Phase 8, decision D6), so it lives in the owning module and the
 * route renders `CustomersLayout` and nothing else. The print rules stay on the header and the
 * outlet wrapper because the statement route beneath this shell prints without chrome.
 */
export function CustomersLayout() {
	const navigate = useNavigate()
	const pathname = useRouterState({ select: (state) => state.location.pathname })

	// Every deeper route starts with /customers, so test the aging prefix first.
	const active: CustomersTab = pathname.startsWith(TAB_LINKS.aging) ? "aging" : "customers"

	return (
		<div className="mx-auto max-w-6xl">
			<div className="print:hidden">
				<PageHeader
					title="Customers"
					description="Customer records, branch credit, repayments, and aging."
				/>

				<Tabs
					value={active}
					onValueChange={(value) => void navigate({ to: TAB_LINKS[value as CustomersTab] })}
				>
					<TabsList>
						<TabsTrigger value="customers">Customers</TabsTrigger>
						<TabsTrigger value="aging">Aging</TabsTrigger>
					</TabsList>
				</Tabs>
			</div>

			<div className="mt-4 print:mt-0">
				<Outlet />
			</div>
		</div>
	)
}
