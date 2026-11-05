import { can } from "@sceptre/shared"
import { getRouteApi, Outlet, useNavigate, useRouterState } from "@tanstack/react-router"
import { PageHeader } from "#/components/common/page-header"
import { Tabs, TabsList, TabsTrigger } from "#/components/ui/tabs"
import { useFlagValues } from "#/lib/flags"
import { toRole } from "#/lib/role"

const authenticatedRoute = getRouteApi("/_authenticated")

const TAB_LINKS = {
	suppliers: "/suppliers",
	invoices: "/suppliers/invoices",
	payments: "/suppliers/payments",
	aging: "/suppliers/aging",
	transfers: "/suppliers/transfers",
	reconciliation: "/suppliers/reconciliation",
} as const

type SuppliersTab = keyof typeof TAB_LINKS

/**
 * The suppliers section shell: header, the tabs, and the tab's outlet.
 *
 * Section layout is page markup (Phase 8, decision D6), so it lives in the owning module and the
 * route renders `SuppliersLayout` and nothing else. The layout belongs to suppliers even though
 * the Invoices, Payments, Aging, Transfers and Reconciliation tabs are other modules' screens
 * (route path ≠ module ownership, decision D6).
 *
 * Transfers and Reconciliation used to be their own rail entries under the same path prefix,
 * which lit the Suppliers item at the same time (P20-D6). They are tabs now: one path, one
 * highlight, and the payables pages sit where a payables reader already looks. Both stay behind
 * the same permission and feature flag the rail entries had, so turning the flag off leaves no
 * dead tab.
 */
export function SuppliersLayout() {
	const navigate = useNavigate()
	const pathname = useRouterState({ select: (state) => state.location.pathname })
	const { session } = authenticatedRoute.useRouteContext()
	const flags = useFlagValues()

	const role = toRole(session.user.role)
	const canReadPayables = role !== null && can(role, "payable.read")
	const showTransfers = canReadPayables && flags["flag.supplierTransfers"]

	const tabs: SuppliersTab[] = ["suppliers", "invoices", "payments", "aging"]
	if (showTransfers) tabs.push("transfers", "reconciliation")

	// Detail routes fall back to the Suppliers tab; match the deeper prefixes first.
	const active: SuppliersTab =
		tabs.find((tab) => tab !== "suppliers" && pathname.startsWith(TAB_LINKS[tab])) ?? "suppliers"

	const labels: Record<SuppliersTab, string> = {
		suppliers: "Suppliers",
		invoices: "Invoices",
		payments: "Payments",
		aging: "Aging",
		transfers: "Transfers",
		reconciliation: "Reconciliation",
	}

	return (
		<div className="mx-auto max-w-6xl">
			<PageHeader
				title="Suppliers"
				description="Supplier records, purchase invoices, payments, payables aging, transfers, and reconciliation."
			/>

			<Tabs
				value={active}
				onValueChange={(value) => void navigate({ to: TAB_LINKS[value as SuppliersTab] })}
			>
				<TabsList>
					{tabs.map((tab) => (
						<TabsTrigger key={tab} value={tab}>
							{labels[tab]}
						</TabsTrigger>
					))}
				</TabsList>
			</Tabs>

			<div className="mt-4">
				<Outlet />
			</div>
		</div>
	)
}
