import { createFileRoute } from "@tanstack/react-router"
import { CustomersLayout } from "#/modules/customers"

export const Route = createFileRoute("/_authenticated/customers")({
	component: CustomersLayout,
})
