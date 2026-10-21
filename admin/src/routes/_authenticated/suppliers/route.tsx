import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router"
import { PageHeader } from "#/components/common/page-header"
import { Tabs, TabsList, TabsTrigger } from "#/components/ui/tabs"

export const Route = createFileRoute("/_authenticated/suppliers")({
	component: SuppliersLayout,
})

const TAB_LINKS = {
	suppliers: "/suppliers",
	invoices: "/suppliers/invoices",
	payments: "/suppliers/payments",
	aging: "/suppliers/aging",
} as const

type SuppliersTab = keyof typeof TAB_LINKS

function SuppliersLayout() {
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
