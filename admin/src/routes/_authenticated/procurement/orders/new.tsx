import { createFileRoute } from "@tanstack/react-router"
import { OrderNewPage } from "#/modules/procurement"

export const Route = createFileRoute("/_authenticated/procurement/orders/new")({
	component: OrderNewPage,
})
