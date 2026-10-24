import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router"
import { PageHeader } from "#/components/common/page-header"
import { Tabs, TabsList, TabsTrigger } from "#/components/ui/tabs"

const TAB_LINKS = {
	products: "/catalog/products",
	categories: "/catalog/categories",
	brands: "/catalog/brands",
	units: "/catalog/units",
} as const

type CatalogTab = keyof typeof TAB_LINKS

/**
 * The catalog section shell: header, the four tabs, and the tab's outlet.
 *
 * Section layout is page markup (Phase 8, decision D6), so it lives in the owning module and the
 * route renders `CatalogLayout` and nothing else. Tab order and labels are unchanged — the sidebar
 * and breadcrumb read the same navigation table.
 */
export function CatalogLayout() {
	const navigate = useNavigate()
	const pathname = useRouterState({ select: (state) => state.location.pathname })

	const active: CatalogTab =
		(Object.keys(TAB_LINKS) as CatalogTab[]).find((tab) => pathname.startsWith(TAB_LINKS[tab])) ??
		"products"

	return (
		<div className="mx-auto max-w-6xl">
			<PageHeader
				title="Catalog"
				description="Products, categories, brands, and units shared across every branch."
			/>

			<Tabs
				value={active}
				onValueChange={(value) => void navigate({ to: TAB_LINKS[value as CatalogTab] })}
			>
				<TabsList>
					<TabsTrigger value="products">Products</TabsTrigger>
					<TabsTrigger value="categories">Categories</TabsTrigger>
					<TabsTrigger value="brands">Brands</TabsTrigger>
					<TabsTrigger value="units">Units</TabsTrigger>
				</TabsList>
			</Tabs>

			<div className="mt-4">
				<Outlet />
			</div>
		</div>
	)
}
