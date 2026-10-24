import { createFileRoute } from "@tanstack/react-router"
import { CountNewPage } from "#/modules/inventory"

export const Route = createFileRoute("/_authenticated/inventory/counts/new")({
	component: CountNewPage,
})
