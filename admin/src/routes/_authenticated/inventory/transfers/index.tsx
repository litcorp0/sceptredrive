import { createFileRoute } from "@tanstack/react-router"
import { TransfersPage } from "#/modules/inventory"

export const Route = createFileRoute("/_authenticated/inventory/transfers/")({
	component: TransfersPage,
})
