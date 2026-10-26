import { createFileRoute, stripSearchParams } from "@tanstack/react-router"
import { StockPage, stockSearchDefaults, stockSearchSchema } from "#/modules/inventory"

export const Route = createFileRoute("/_authenticated/inventory/stock/")({
	validateSearch: stockSearchSchema,
	search: { middlewares: [stripSearchParams(stockSearchDefaults)] },
	component: StockPage,
})
