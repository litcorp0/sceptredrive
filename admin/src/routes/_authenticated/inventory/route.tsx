import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router"
import { PageHeader } from "#/components/common/page-header"
import { Tabs, TabsList, TabsTrigger } from "#/components/ui/tabs"

export const Route = createFileRoute("/_authenticated/inventory")({
	component: InventoryLayout,
})

const TAB_LINKS = {
	stock: "/inventory/stock",
	receipts: "/inventory/receipts",
	transfers: "/inventory/transfers",
	counts: "/inventory/counts",
} as const

type InventoryTab = keyof typeof TAB_LINKS

function InventoryLayout() {
	const navigate = useNavigate()
	const pathname = useRouterState({ select: (state) => state.location.pathname })

	const active: InventoryTab =
		(Object.keys(TAB_LINKS) as InventoryTab[]).find((tab) => pathname.startsWith(TAB_LINKS[tab])) ??
		"stock"

	return (
		<div className="mx-auto max-w-6xl">
			<PageHeader
				title="Inventory"
				description="Stock levels, goods receipts, adjustments, transfers, and counts."
			/>

			<Tabs
				value={active}
				onValueChange={(value) => void navigate({ to: TAB_LINKS[value as InventoryTab] })}
			>
				<TabsList>
					<TabsTrigger value="stock" onClick={() => void navigate({ to: TAB_LINKS.stock })}>
						Stock
					</TabsTrigger>
					<TabsTrigger value="receipts" onClick={() => void navigate({ to: TAB_LINKS.receipts })}>
						Receipts
					</TabsTrigger>
					<TabsTrigger value="transfers" onClick={() => void navigate({ to: TAB_LINKS.transfers })}>
						Transfers
					</TabsTrigger>
					<TabsTrigger value="counts" onClick={() => void navigate({ to: TAB_LINKS.counts })}>
						Counts
					</TabsTrigger>
				</TabsList>
			</Tabs>

			<div className="mt-4">
				<Outlet />
			</div>
		</div>
	)
}
