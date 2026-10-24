import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router"
import { PageHeader } from "#/components/common/page-header"
import { Tabs, TabsList, TabsTrigger } from "#/components/ui/tabs"

const TAB_LINKS = {
	suppliers: "/suppliers",
	invoices: "/suppliers/invoices",
	payments: "/suppliers/payments",
	aging: "/suppliers/aging",
} as const

type SuppliersTab = keyof typeof TAB_LINKS

/**
 * The suppliers section shell: header, the four tabs, and the tab's outlet.
 *
 * Section layout is page markup (Phase 8, decision D6), so it lives in the owning module and the
 * route renders `SuppliersLayout` and nothing else. The layout belongs to suppliers even though
 * the Invoices, Payments and Aging tabs are payables screens (route path ≠ module ownership,
 * decision D6): those tabs still point at their pre-Phase-8 routes until Plan 11 moves them.
 * Tab order and labels are unchanged.
 */
export function SuppliersLayout() {
	const navigate = useNavigate()
	const pathname = useRouterState({ select: (state) => state.location.pathname })

	// Detail routes fall back to the Suppliers tab; match the deeper prefixes first.
	const active: SuppliersTab =
		(Object.keys(TAB_LINKS) as SuppliersTab[]).find(
			(tab) => tab !== "suppliers" && pathname.startsWith(TAB_LINKS[tab]),
		) ?? "suppliers"

	return (
		<div className="mx-auto max-w-6xl">
			<PageHeader
				title="Suppliers"
				description="Supplier records, purchase invoices, payments, and payables aging."
			/>

			<Tabs
				value={active}
				onValueChange={(value) => void navigate({ to: TAB_LINKS[value as SuppliersTab] })}
			>
				<TabsList>
					<TabsTrigger value="suppliers">Suppliers</TabsTrigger>
					<TabsTrigger value="invoices">Invoices</TabsTrigger>
					<TabsTrigger value="payments">Payments</TabsTrigger>
					<TabsTrigger value="aging">Aging</TabsTrigger>
				</TabsList>
			</Tabs>

			<div className="mt-4">
				<Outlet />
			</div>
		</div>
	)
}
