import { createFileRoute } from "@tanstack/react-router"
import { OpeningNewPage } from "#/modules/inventory"

export const Route = createFileRoute("/_authenticated/inventory/openings/new")({
	component: OpeningNewPage,
})
