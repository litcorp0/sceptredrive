import { createFileRoute } from "@tanstack/react-router"
import { OrderDetailPage } from "#/modules/procurement"

export const Route = createFileRoute("/_authenticated/procurement/orders/$orderId")({
	component: OrderDetailPage,
})
