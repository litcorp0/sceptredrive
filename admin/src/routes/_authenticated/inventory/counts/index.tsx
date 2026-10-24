import { createFileRoute } from "@tanstack/react-router"
import { CountsPage } from "#/modules/inventory"

export const Route = createFileRoute("/_authenticated/inventory/counts/")({
	component: CountsPage,
})
