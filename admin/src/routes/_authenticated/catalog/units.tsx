import { createFileRoute } from "@tanstack/react-router"
import { UnitsPage } from "#/modules/catalog"

export const Route = createFileRoute("/_authenticated/catalog/units")({
	component: UnitsPage,
})
