import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router"
import { PageHeader } from "#/components/common/page-header"
import { Tabs, TabsList, TabsTrigger } from "#/components/ui/tabs"

export const Route = createFileRoute("/_authenticated/customers")({
	component: CustomersLayout,
})

const TAB_LINKS = {
	customers: "/customers",
	aging: "/customers/aging",
} as const

type CustomersTab = keyof typeof TAB_LINKS

function CustomersLayout() {
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
