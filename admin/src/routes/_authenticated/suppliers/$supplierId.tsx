import { createFileRoute } from "@tanstack/react-router"
import { SupplierDetailPage } from "#/modules/suppliers"

export const Route = createFileRoute("/_authenticated/suppliers/$supplierId")({
	component: SupplierDetailPage,
})
