import { createFileRoute } from "@tanstack/react-router"
import { SaleDetailPage } from "#/modules/pos-oversight"

export const Route = createFileRoute("/_authenticated/pos/sales/$saleId")({
	component: SaleDetailPage,
})
