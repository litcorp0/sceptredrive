import { createFileRoute } from "@tanstack/react-router"
import { SupplierPerformancePage } from "#/modules/replenishment"

export const Route = createFileRoute("/_authenticated/procurement/suppliers")({
	component: SupplierPerformancePage,
})
