import { createFileRoute } from "@tanstack/react-router"
import { ReplenishmentPage } from "#/modules/replenishment"

export const Route = createFileRoute("/_authenticated/procurement/replenishment")({
	component: ReplenishmentPage,
})
