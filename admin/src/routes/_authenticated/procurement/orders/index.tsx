import { createFileRoute } from "@tanstack/react-router"
import { OrdersPage } from "#/modules/procurement"

export const Route = createFileRoute("/_authenticated/procurement/orders/")({
	component: OrdersPage,
})
