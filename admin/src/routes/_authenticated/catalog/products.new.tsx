import { createFileRoute } from "@tanstack/react-router"
import { ProductNewPage } from "#/modules/catalog"

export const Route = createFileRoute("/_authenticated/catalog/products/new")({
	component: ProductNewPage,
})
