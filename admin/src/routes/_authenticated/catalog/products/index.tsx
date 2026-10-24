import { createFileRoute } from "@tanstack/react-router"
import { ProductsPage } from "#/modules/catalog"

export const Route = createFileRoute("/_authenticated/catalog/products/")({
	component: ProductsPage,
})
