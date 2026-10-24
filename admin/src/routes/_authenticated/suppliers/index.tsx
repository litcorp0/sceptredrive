import { createFileRoute } from "@tanstack/react-router"
import { SuppliersPage } from "#/modules/suppliers"

export const Route = createFileRoute("/_authenticated/suppliers/")({
	component: SuppliersPage,
})
