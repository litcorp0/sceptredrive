import { createFileRoute } from "@tanstack/react-router"
import { ReceiptsPage } from "#/modules/inventory"

export const Route = createFileRoute("/_authenticated/inventory/receipts/")({
	component: ReceiptsPage,
})
