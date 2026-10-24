import { createFileRoute } from "@tanstack/react-router"
import { CustomerDetailPage } from "#/modules/customers"

export const Route = createFileRoute("/_authenticated/customers/$id/")({
	component: CustomerDetailPage,
})
