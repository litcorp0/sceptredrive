import { createFileRoute } from "@tanstack/react-router"
import { OpeningsPage } from "#/modules/inventory"

export const Route = createFileRoute("/_authenticated/inventory/openings/")({
	component: OpeningsPage,
})
