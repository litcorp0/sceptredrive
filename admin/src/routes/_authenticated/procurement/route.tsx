import { createFileRoute } from "@tanstack/react-router"
import { ProcurementLayout } from "#/modules/procurement"

export const Route = createFileRoute("/_authenticated/procurement")({
	component: ProcurementLayout,
})
