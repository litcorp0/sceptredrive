import { createFileRoute } from "@tanstack/react-router"
import { CreditAgingPage } from "#/modules/credit"

export const Route = createFileRoute("/_authenticated/customers/aging")({
	component: CreditAgingPage,
})
