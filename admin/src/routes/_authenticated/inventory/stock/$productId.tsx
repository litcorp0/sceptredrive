import { createFileRoute } from "@tanstack/react-router"
import { StockDetailPage } from "#/modules/inventory"

export const Route = createFileRoute("/_authenticated/inventory/stock/$productId")({
	component: StockDetailPage,
})
