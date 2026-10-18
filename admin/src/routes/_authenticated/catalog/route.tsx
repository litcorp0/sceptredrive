import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router"
import { PageHeader } from "#/components/common/page-header"
import { Tabs, TabsList, TabsTrigger } from "#/components/ui/tabs"

export const Route = createFileRoute("/_authenticated/catalog")({
	component: CatalogLayout,
})

const TAB_LINKS = {
	products: "/catalog/products",
	categories: "/catalog/categories",
	brands: "/catalog/brands",
	units: "/catalog/units",
} as const

type CatalogTab = keyof typeof TAB_LINKS

function CatalogLayout() {
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
