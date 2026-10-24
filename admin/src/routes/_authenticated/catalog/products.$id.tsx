import { createFileRoute } from "@tanstack/react-router"
import { ProductDetailPage } from "#/modules/catalog"

export const Route = createFileRoute("/_authenticated/catalog/products/$id")({
	component: ProductDetailPage,
})
