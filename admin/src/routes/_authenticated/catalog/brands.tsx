import { createFileRoute } from "@tanstack/react-router"
import { BrandsPage } from "#/modules/catalog"

export const Route = createFileRoute("/_authenticated/catalog/brands")({
	component: BrandsPage,
})
