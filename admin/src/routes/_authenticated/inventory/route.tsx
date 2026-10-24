import { createFileRoute } from "@tanstack/react-router"
import { InventoryLayout } from "#/modules/inventory"

export const Route = createFileRoute("/_authenticated/inventory")({
	component: InventoryLayout,
})
