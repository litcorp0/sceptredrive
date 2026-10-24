import { createFileRoute } from "@tanstack/react-router"
import { CatalogLayout } from "#/modules/catalog"

export const Route = createFileRoute("/_authenticated/catalog")({
	component: CatalogLayout,
})
