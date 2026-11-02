import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router"
import { PageHeader } from "#/components/common/page-header"
import { Tabs, TabsList, TabsTrigger } from "#/components/ui/tabs"

const TAB_LINKS = {
	stock: "/inventory/stock",
	receipts: "/inventory/receipts",
	transfers: "/inventory/transfers",
	writeOffs: "/inventory/write-offs",
	counts: "/inventory/counts",
	openings: "/inventory/openings",
} as const

type InventoryTab = keyof typeof TAB_LINKS

/**
 * The inventory section shell: header, the section tabs, and the tab's outlet.
 *
 * Section layout is page markup (Phase 8, decision D6), so it lives in the owning module and the
 * route renders `InventoryLayout` and nothing else. Tab order and labels are unchanged.
 */
export function InventoryLayout() {
	const navigate = useNavigate()
	const pathname = useRouterState({ select: (state) => state.location.pathname })

	const active: InventoryTab =
		(Object.keys(TAB_LINKS) as InventoryTab[]).find((tab) => pathname.startsWith(TAB_LINKS[tab])) ??
		"stock"

	return (
		<div className="mx-auto max-w-6xl">
			<PageHeader
				title="Inventory"
				description="Stock levels, goods receipts, adjustments, transfers, write-offs, counts and go-live opening stock."
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
					<TabsTrigger value="writeOffs" onClick={() => void navigate({ to: TAB_LINKS.writeOffs })}>
						Write-offs
					</TabsTrigger>
					<TabsTrigger value="counts" onClick={() => void navigate({ to: TAB_LINKS.counts })}>
						Counts
					</TabsTrigger>
					<TabsTrigger value="openings" onClick={() => void navigate({ to: TAB_LINKS.openings })}>
						Opening stock
					</TabsTrigger>
				</TabsList>
			</Tabs>

			<div className="mt-4">
				<Outlet />
			</div>
		</div>
	)
}
