import { createFileRoute } from "@tanstack/react-router"
import { StockPage } from "#/modules/inventory"

export const Route = createFileRoute("/_authenticated/inventory/stock/")({
	component: StockPage,
})
