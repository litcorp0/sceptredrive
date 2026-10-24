import { createFileRoute } from "@tanstack/react-router"
import { SuppliersLayout } from "#/modules/suppliers"

export const Route = createFileRoute("/_authenticated/suppliers")({
	component: SuppliersLayout,
})
