import { createFileRoute } from "@tanstack/react-router"
import { PayablesAgingPage } from "#/modules/payables"

export const Route = createFileRoute("/_authenticated/suppliers/aging")({
	component: PayablesAgingPage,
})
